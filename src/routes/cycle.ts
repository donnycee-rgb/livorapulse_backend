import { FastifyInstance } from 'fastify'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { daysQuerySchema, logCycleSchema, periodDaySchema, periodEndedSchema, removeDaySchema, updateCycleSettingsSchema } from '../schemas/cycle.schema'
import { addDays, dayKey } from '../utils/day'
import { prisma } from '../db/prisma'
import { cycleOverview, syncCycleLogs, toDate } from '../services/CycleService'
import { addDaysKey, calendarMarks, cycleLengths, daysBetweenKeys } from '../utils/cycle'
import { AppError } from '../utils/response'

// The tracker works from logged period days (PeriodDay); the two helpers
// below are the older start-date maths, still used by insights and the AI
// coach through the CycleLog rows that are rebuilt from those days.

// ---------------------------------------------------------------------------
// Smart average — reads last 6 actual cycle lengths, drops outlier if 4+,
// returns averaged cycle length and period duration
// ---------------------------------------------------------------------------
export function computeSmartAverage(
  logs: Array<{
    periodStartDate: Date
    periodDuration: number
    actualCycleLength: number | null
  }>,
  fallbackCycleLength?: number | null,
): { cycleLength: number; periodDuration: number } {
  // Collect actual cycle lengths (gaps between consecutive periods)
  const actuals = logs
    .map(l => l.actualCycleLength)
    .filter((v): v is number => v !== null && v >= 15 && v <= 60)

  // Average period duration from all logs
  const avgDuration = logs.length > 0
    ? Math.round(logs.reduce((s, l) => s + l.periodDuration, 0) / logs.length)
    : 5

  if (actuals.length === 0) {
    // Not enough history yet — use the length the user entered, then their saved default
    return { cycleLength: fallbackCycleLength ?? 28, periodDuration: avgDuration }
  }

  let working = [...actuals]

  // Drop the outlier furthest from the mean when we have 4+ data points
  if (working.length >= 4) {
    const mean = working.reduce((s, v) => s + v, 0) / working.length
    let maxDist = 0
    let outlierIdx = -1
    working.forEach((v, i) => {
      const dist = Math.abs(v - mean)
      if (dist > maxDist) { maxDist = dist; outlierIdx = i }
    })
    if (outlierIdx !== -1) working.splice(outlierIdx, 1)
  }

  const avgCycle = Math.round(working.reduce((s, v) => s + v, 0) / working.length)
  return { cycleLength: avgCycle, periodDuration: avgDuration }
}

// ---------------------------------------------------------------------------
// Compute cycle phase from a period start date + cycle/duration lengths.
// Days are local (Nairobi) calendar days.
//
// - daysUntilNextPeriod counts full days after today (0 = expected tomorrow).
// - When the expected date passes without a new period being logged, the
//   cycle is reported as late instead of silently starting a new cycle.
// ---------------------------------------------------------------------------
function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86400000)
}

export function computeCyclePhase(
  lastPeriodStart: Date,
  cycleLength: number,
  periodDuration: number,
  todayKey: string = dayKey(),
): {
  phase: 'menstrual' | 'follicular' | 'ovulation' | 'luteal'
  dayOfCycle: number
  daysUntilNextPeriod: number
  periodActive: boolean
  nextPeriodDate: string
  fertileWindowStart: number
  fertileWindowEnd: number
  ovulationDay: number
  periodDueToday: boolean
  isLate: boolean
  daysLate: number
} {
  const startKey = dayKey(lastPeriodStart)
  const daysSinceStart = Math.max(0, daysBetween(startKey, todayKey))

  // 1-based and NOT wrapped: day 31 of a 28-day cycle means the period is late
  const dayOfCycle = daysSinceStart + 1
  const daysUntilNextPeriod = Math.max(0, cycleLength - dayOfCycle)
  const periodDueToday = dayOfCycle === cycleLength + 1
  const daysLate = Math.max(0, dayOfCycle - (cycleLength + 1))
  const isLate = daysLate > 0

  // Expected start of the next period (in the past when late)
  const nextPeriodDate = addDays(startKey, cycleLength)

  // Ovulation ≈ 14 days before the next period; fertile window = 5 days up to it
  const ovulationDay = cycleLength - 14
  const fertileWindowStart = Math.max(ovulationDay - 4, periodDuration + 1)
  const fertileWindowEnd = ovulationDay

  let phase: 'menstrual' | 'follicular' | 'ovulation' | 'luteal'
  if (dayOfCycle <= periodDuration) phase = 'menstrual'
  else if (dayOfCycle < ovulationDay) phase = 'follicular'
  else if (dayOfCycle <= ovulationDay + 1) phase = 'ovulation'
  else phase = 'luteal' // includes "due" and "late" days until a new period is logged

  return {
    phase,
    dayOfCycle,
    daysUntilNextPeriod,
    periodActive: phase === 'menstrual',
    nextPeriodDate,
    fertileWindowStart,
    fertileWindowEnd,
    ovulationDay,
    periodDueToday,
    isLate,
    daysLate,
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
export async function cycleRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  /** A day may be logged up to today (one day of slack for time zones) */
  const notFuture = (key: string) => {
    if (key > addDaysKey(dayKey(), 1)) throw new AppError('VALIDATION_ERROR', "A period day can't be in the future", 400)
  }

  // GET /api/cycle — today's place in the cycle, the next period, the averages
  app.get('/', async (request, reply) => {
    const userId = request.user!.id
    const { status, stats } = await cycleOverview(userId)
    if (!status) return reply.send({ success: true, data: null })
    return reply.send({
      success: true,
      data: {
        ...status,
        // names the Dashboard card already reads
        periodStartDate: `${status.lastPeriodStart}T00:00:00.000Z`,
        smartCycleLength: stats.cycleLength,
        smartDuration: stats.periodLength,
        spread: stats.spread,
        cyclesUsed: stats.cyclesUsed,
      },
    })
  })

  // GET /api/cycle/days?from=&to= — logged days and calendar marks for a range
  app.get('/days', async (request, reply) => {
    const userId = request.user!.id
    const { from, to } = validate(daysQuerySchema, request.query)
    if (daysBetweenKeys(from, to) < 0 || daysBetweenKeys(from, to) > 120) throw new AppError('VALIDATION_ERROR', 'Ask for at most 120 days', 400)
    const today = dayKey()
    const { days, periods, stats } = await cycleOverview(userId, today)
    const inRange = days.filter((d) => d.date >= from && d.date <= to)
    const marks = calendarMarks(periods, stats, new Set(days.map((d) => d.date)), from, to, today)
    return reply.send({ success: true, data: { days: inRange, marks } })
  })

  // POST /api/cycle/days — set a period day (flow, symptoms, notes). One row per day.
  app.post('/days', async (request, reply) => {
    const userId = request.user!.id
    const body = validate(periodDaySchema, request.body)
    notFuture(body.date)
    const data = {
      flow: body.flow ?? null,
      symptoms: body.symptoms ?? [],
      notes: body.notes ?? null,
    }
    const row = await prisma.periodDay.upsert({
      where: { userId_date: { userId, date: toDate(body.date) } },
      create: { userId, date: toDate(body.date), ...data },
      update: data,
      select: { date: true, flow: true, symptoms: true, notes: true },
    })
    await syncCycleLogs(userId)
    return reply.send({ success: true, data: { ...row, date: body.date } })
  })

  // POST /api/cycle/days/remove — this wasn't a period day after all
  app.post('/days/remove', async (request, reply) => {
    const userId = request.user!.id
    const { date } = validate(removeDaySchema, request.body)
    await prisma.periodDay.deleteMany({ where: { userId, date: toDate(date) } })
    await syncCycleLogs(userId)
    return reply.send({ success: true })
  })

  // POST /api/cycle/period-ended — "my period ended": it stops showing as
  // going on. Logging a later day of the same period reopens it.
  app.post('/period-ended', async (request, reply) => {
    const userId = request.user!.id
    const body = validate(periodEndedSchema, request.body)
    let endedOn: Date | null = null
    if ('lastDay' in body) {
      notFuture(body.lastDay)
      endedOn = toDate(body.lastDay)
    }
    await prisma.userProfile.upsert({
      where: { userId },
      create: { userId, periodEndedOn: endedOn },
      update: { periodEndedOn: endedOn },
    })
    return reply.send({ success: true })
  })

  // GET /api/cycle/history — periods, newest first, with the cycle each began
  app.get('/history', async (request, reply) => {
    const userId = request.user!.id
    const { periods, stats } = await cycleOverview(userId)
    const lengths = periods.map((p, i) => {
      const next = periods[i + 1]
      const gap = next ? daysBetweenKeys(p.start, next.start) : null
      return gap !== null && gap >= 15 && gap <= 60 ? gap : null
    })
    const data = periods.map((p, i) => ({ ...p, cycleLength: lengths[i] })).reverse().slice(0, 12)
    return reply.send({ success: true, data: { periods: data, stats, cycles: cycleLengths(periods).length } })
  })

  // GET /api/cycle/settings — the person's usual cycle and whether tracking is on
  app.get('/settings', async (request, reply) => {
    const userId = request.user!.id
    const p = await prisma.userProfile.findUnique({ where: { userId }, select: { defaultCycleLength: true, defaultPeriodDuration: true, cycleTracking: true, gender: true } })
    return reply.send({
      success: true,
      data: {
        cycleLength: p?.defaultCycleLength ?? 28,
        periodDuration: p?.defaultPeriodDuration ?? 5,
        tracking: p?.cycleTracking ?? p?.gender === 'female',
      },
    })
  })

  // PUT /api/cycle/settings — usual cycle and period length, tracking on/off
  app.put('/settings', async (request, reply) => {
    const userId = request.user!.id
    const body = validate(updateCycleSettingsSchema.partial(), request.body)
    await prisma.userProfile.upsert({
      where: { userId },
      create: {
        userId,
        defaultCycleLength: body.cycleLength ?? 28,
        defaultPeriodDuration: body.periodDuration ?? 5,
        cycleTracking: body.tracking,
      },
      update: {
        defaultCycleLength: body.cycleLength,
        defaultPeriodDuration: body.periodDuration,
        cycleTracking: body.tracking,
      },
    })
    if (body.cycleLength !== undefined) await syncCycleLogs(userId)
    return reply.send({ success: true })
  })

  // POST /api/cycle — an older app version's "my period started on …":
  // becomes that day plus the usual number of days after it
  app.post('/', async (request, reply) => {
    const userId = request.user!.id
    const body = validate(logCycleSchema, request.body)
    const start = new Date(body.periodStartDate).toISOString().slice(0, 10)
    notFuture(start)
    for (let i = 0; i < body.periodDuration; i++) {
      const date = toDate(addDays(start, i))
      const first = i === 0
      await prisma.periodDay.upsert({
        where: { userId_date: { userId, date } },
        create: { userId, date, flow: first ? body.flowIntensity ?? null : null, symptoms: first ? body.symptoms ?? [] : [], notes: first ? body.notes ?? null : null },
        update: {},
      })
    }
    await syncCycleLogs(userId)
    return reply.status(201).send({ success: true })
  })
}
