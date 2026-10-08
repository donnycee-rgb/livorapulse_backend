import { FastifyInstance } from 'fastify'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { logCycleSchema, updateCycleSettingsSchema } from '../schemas/cycle.schema'
import { addDays, dayKey } from '../utils/day'
import { prisma } from '../db/prisma'

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

  // POST /api/cycle — log a period start
  app.post('/', async (request, reply) => {
    const body = validate(logCycleSchema, request.body)
    const userId = request.user!.id

    // Fetch previous period to calculate actual cycle length
    const previous = await prisma.cycleLog.findFirst({
      where: { userId },
      orderBy: { periodStartDate: 'desc' },
      select: { periodStartDate: true },
    })

    let actualCycleLength: number | null = null
    if (previous) {
      const gap = daysBetween(dayKey(previous.periodStartDate), dayKey(new Date(body.periodStartDate)))
      // Only trust gaps between 15 and 60 days as valid cycle lengths
      if (gap >= 15 && gap <= 60) actualCycleLength = gap
    }

    const entry = await prisma.cycleLog.create({
      data: {
        userId,
        periodStartDate:  new Date(body.periodStartDate),
        cycleLength:      body.cycleLength,
        periodDuration:   body.periodDuration,
        flowIntensity:    body.flowIntensity ?? null,
        symptoms:         body.symptoms ?? [],
        notes:            body.notes ?? null,
        actualCycleLength,
      },
      select: {
        id: true, periodStartDate: true, cycleLength: true,
        periodDuration: true, flowIntensity: true, symptoms: true,
        notes: true, actualCycleLength: true, createdAt: true,
      },
    })

    return reply.status(201).send({ success: true, data: entry })
  })

  // GET /api/cycle — latest log + computed phase
  app.get('/', async (request, reply) => {
    const userId = request.user!.id

    const latest = await prisma.cycleLog.findFirst({
      where: { userId },
      orderBy: { periodStartDate: 'desc' },
      select: {
        id: true, periodStartDate: true, cycleLength: true,
        periodDuration: true, flowIntensity: true, symptoms: true,
        notes: true, actualCycleLength: true,
      },
    })

    if (!latest) return reply.send({ success: true, data: null })

    // Use smart average cycle length for phase calculation
    const recentLogs = await prisma.cycleLog.findMany({
      where: { userId },
      orderBy: { periodStartDate: 'desc' },
      take: 6,
      select: { periodStartDate: true, periodDuration: true, actualCycleLength: true },
    })

    const profile = await prisma.userProfile.findUnique({
      where: { userId },
      select: { defaultCycleLength: true },
    })
    const { cycleLength: smartCycleLength, periodDuration: smartDuration } =
      // Until there's enough history to average: the user's saved setting, then the length on the log
      computeSmartAverage(recentLogs, profile?.defaultCycleLength ?? latest.cycleLength)

    const cycleInfo = computeCyclePhase(
      latest.periodStartDate,
      smartCycleLength,
      smartDuration,
    )

    return reply.send({
      success: true,
      data: {
        ...latest,
        ...cycleInfo,
        smartCycleLength,
        smartDuration,
      },
    })
  })

  // GET /api/cycle/smart-average — returns the smart averaged values
  app.get('/smart-average', async (request, reply) => {
    const userId = request.user!.id

    // Also read saved defaults from user profile as fallback
    const profile = await prisma.userProfile.findUnique({
      where: { userId },
      select: { defaultCycleLength: true, defaultPeriodDuration: true },
    })

    const logs = await prisma.cycleLog.findMany({
      where: { userId },
      orderBy: { periodStartDate: 'desc' },
      take: 6,
      select: { periodStartDate: true, periodDuration: true, actualCycleLength: true },
    })

    if (logs.length < 2) {
      // Not enough data — use profile defaults or standard defaults
      return reply.send({
        success: true,
        data: {
          cycleLength:    profile?.defaultCycleLength    ?? 28,
          periodDuration: profile?.defaultPeriodDuration ?? 5,
          dataPoints: logs.length,
          source: logs.length === 0 ? 'default' : 'single-log',
        },
      })
    }

    const { cycleLength, periodDuration } = computeSmartAverage(logs, profile?.defaultCycleLength)
    return reply.send({
      success: true,
      data: {
        cycleLength,
        periodDuration,
        dataPoints: logs.length,
        source: 'smart-average',
      },
    })
  })

  // GET /api/cycle/history — last 6 cycles with full data
  app.get('/history', async (request, reply) => {
    const userId = request.user!.id

    const logs = await prisma.cycleLog.findMany({
      where: { userId },
      orderBy: { periodStartDate: 'desc' },
      take: 6,
      select: {
        id: true, periodStartDate: true, cycleLength: true,
        periodDuration: true, flowIntensity: true, symptoms: true,
        notes: true, actualCycleLength: true, createdAt: true,
      },
    })

    return reply.send({ success: true, data: logs })
  })

  // GET /api/cycle/calendar?year=2026&month=3 — all events for a month
  app.get('/calendar', async (request, reply) => {
    const userId = request.user!.id
    const { year, month } = request.query as { year?: string; month?: string }

    const y = parseInt(year  ?? String(new Date().getFullYear()), 10)
    const m = parseInt(month ?? String(new Date().getMonth() + 1), 10)

    // Get all logs to build calendar
    const logs = await prisma.cycleLog.findMany({
      where: { userId },
      orderBy: { periodStartDate: 'asc' },
      select: {
        periodStartDate: true, cycleLength: true,
        periodDuration: true, actualCycleLength: true,
      },
    })

    if (logs.length === 0) return reply.send({ success: true, data: { events: [] } })

    const recentLogs = [...logs].reverse().slice(0, 6)
    const { cycleLength: smartCycle, periodDuration: smartDuration } =
      computeSmartAverage(recentLogs, recentLogs[0]?.cycleLength)

    // Build day-by-day events map for the requested month ± 1 month buffer
    const events: Record<string, {
      type: 'period' | 'fertile' | 'ovulation' | 'predicted-period' | 'predicted-fertile' | 'predicted-ovulation'
      logged: boolean
    }> = {}

    const tag = (date: Date, type: typeof events[string]['type'], logged: boolean) => {
      const key = date.toISOString().split('T')[0]
      // Don't overwrite a higher-priority event (period > ovulation > fertile)
      const priority: Record<string, number> = {
        'period': 5, 'predicted-period': 4,
        'ovulation': 3, 'predicted-ovulation': 3,
        'fertile': 2, 'predicted-fertile': 1,
      }
      if (!events[key] || priority[type] > priority[events[key].type]) {
        events[key] = { type, logged }
      }
    }

    // Mark all logged periods
    logs.forEach((log, idx) => {
      const start = new Date(log.periodStartDate)
      start.setHours(0, 0, 0, 0)

      // Period days
      for (let d = 0; d < log.periodDuration; d++) {
        const day = new Date(start)
        day.setDate(start.getDate() + d)
        tag(day, 'period', true)
      }

      // Ovulation and fertile window for this cycle
      const oDay = log.cycleLength - 14
      const fertStart = Math.max(oDay - 4, log.periodDuration + 1)

      for (let d = fertStart - 1; d < oDay - 1; d++) {
        const day = new Date(start)
        day.setDate(start.getDate() + d)
        tag(day, 'fertile', true)
      }
      const ovDay = new Date(start)
      ovDay.setDate(start.getDate() + oDay - 1)
      tag(ovDay, 'ovulation', true)
    })

    // Project future predictions from the last logged period
    const lastLog = logs[logs.length - 1]
    const lastStart = new Date(lastLog.periodStartDate)
    lastStart.setHours(0, 0, 0, 0)

    // Project 3 cycles into the future
    for (let cycle = 1; cycle <= 3; cycle++) {
      const predStart = new Date(lastStart)
      predStart.setDate(lastStart.getDate() + smartCycle * cycle)

      // Predicted period days
      for (let d = 0; d < smartDuration; d++) {
        const day = new Date(predStart)
        day.setDate(predStart.getDate() + d)
        tag(day, 'predicted-period', false)
      }

      // Predicted fertile + ovulation
      const oDay = smartCycle - 14
      const fertStart = Math.max(oDay - 4, smartDuration + 1)
      for (let d = fertStart - 1; d < oDay - 1; d++) {
        const day = new Date(predStart)
        day.setDate(predStart.getDate() + d)
        tag(day, 'predicted-fertile', false)
      }
      const ovDay = new Date(predStart)
      ovDay.setDate(predStart.getDate() + oDay - 1)
      tag(ovDay, 'predicted-ovulation', false)
    }

    // Filter to the requested month
    const startOfMonth = new Date(y, m - 1, 1)
    const endOfMonth   = new Date(y, m, 0)

    const filtered = Object.entries(events)
      .filter(([key]) => {
        const d = new Date(key)
        return d >= startOfMonth && d <= endOfMonth
      })
      .map(([date, ev]) => ({ date, ...ev }))

    return reply.send({ success: true, data: { events: filtered, smartCycleLength: smartCycle } })
  })

  // PUT /api/cycle/settings — save default cycle length and duration to profile
  app.put('/settings', async (request, reply) => {
    const userId = request.user!.id
    // A cycle length of 0 would break every phase calculation
    const body = validate(updateCycleSettingsSchema.partial(), request.body)

    await prisma.userProfile.upsert({
      where: { userId },
      create: {
        userId,
        defaultCycleLength:    body.cycleLength    ?? 28,
        defaultPeriodDuration: body.periodDuration ?? 5,
      },
      update: {
        defaultCycleLength:    body.cycleLength,
        defaultPeriodDuration: body.periodDuration,
      },
    })

    return reply.send({ success: true })
  })

  // DELETE /api/cycle/:id
  app.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const userId = request.user!.id
    await prisma.cycleLog.deleteMany({ where: { id, userId } })
    return reply.send({ success: true })
  })
}