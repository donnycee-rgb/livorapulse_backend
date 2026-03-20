import { FastifyInstance } from 'fastify'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { logCycleSchema, updateCycleSettingsSchema } from '../schemas/cycle.schema'
import { prisma } from '../db/prisma'

// ---------------------------------------------------------------------------
// Cycle phase calculation
// ---------------------------------------------------------------------------
export function computeCyclePhase(
  lastPeriodStart: Date,
  cycleLength: number,
  periodDuration: number,
): {
  phase: 'menstrual' | 'follicular' | 'ovulation' | 'luteal'
  dayOfCycle: number
  daysUntilNextPeriod: number
  nextPeriodDate: string
  fertileWindowStart: number
  fertileWindowEnd: number
} {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = new Date(lastPeriodStart)
  start.setHours(0, 0, 0, 0)

  const daysSinceStart = Math.floor(
    (today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
  )

  // Day of cycle (1-based, wraps)
  const dayOfCycle = (daysSinceStart % cycleLength) + 1
  const daysUntilNextPeriod = cycleLength - (daysSinceStart % cycleLength)

  const nextPeriodDate = new Date(today)
  nextPeriodDate.setDate(today.getDate() + daysUntilNextPeriod)

  // Ovulation typically day 14 (from start), fertile window ±2 days
  const ovulationDay = cycleLength - 14
  const fertileWindowStart = ovulationDay - 2
  const fertileWindowEnd = ovulationDay + 2

  let phase: 'menstrual' | 'follicular' | 'ovulation' | 'luteal'
  if (dayOfCycle <= periodDuration) {
    phase = 'menstrual'
  } else if (dayOfCycle < ovulationDay - 1) {
    phase = 'follicular'
  } else if (dayOfCycle >= ovulationDay - 1 && dayOfCycle <= ovulationDay + 1) {
    phase = 'ovulation'
  } else {
    phase = 'luteal'
  }

  return {
    phase,
    dayOfCycle,
    daysUntilNextPeriod,
    nextPeriodDate: nextPeriodDate.toISOString().split('T')[0],
    fertileWindowStart,
    fertileWindowEnd,
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

    const entry = await prisma.cycleLog.create({
      data: {
        userId,
        periodStartDate: new Date(body.periodStartDate),
        cycleLength: body.cycleLength,
        periodDuration: body.periodDuration,
        flowIntensity: body.flowIntensity ?? null,
        symptoms: body.symptoms ?? [],
        notes: body.notes ?? null,
      },
      select: {
        id: true,
        periodStartDate: true,
        cycleLength: true,
        periodDuration: true,
        flowIntensity: true,
        symptoms: true,
        notes: true,
        createdAt: true,
      },
    })

    return reply.status(201).send({ success: true, data: entry })
  })

  // GET /api/cycle — get latest cycle log + computed phase
  app.get('/', async (request, reply) => {
    const userId = request.user!.id

    const latest = await prisma.cycleLog.findFirst({
      where: { userId },
      orderBy: { periodStartDate: 'desc' },
      select: {
        id: true,
        periodStartDate: true,
        cycleLength: true,
        periodDuration: true,
        flowIntensity: true,
        symptoms: true,
        notes: true,
      },
    })

    if (!latest) {
      return reply.send({ success: true, data: null })
    }

    const cycleInfo = computeCyclePhase(
      latest.periodStartDate,
      latest.cycleLength,
      latest.periodDuration,
    )

    return reply.send({
      success: true,
      data: { ...latest, ...cycleInfo },
    })
  })

  // GET /api/cycle/history — last 6 cycles
  app.get('/history', async (request, reply) => {
    const userId = request.user!.id

    const logs = await prisma.cycleLog.findMany({
      where: { userId },
      orderBy: { periodStartDate: 'desc' },
      take: 6,
      select: {
        id: true,
        periodStartDate: true,
        cycleLength: true,
        periodDuration: true,
        flowIntensity: true,
        symptoms: true,
      },
    })

    return reply.send({ success: true, data: logs })
  })

  // DELETE /api/cycle/:id — delete a log entry
  app.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const userId = request.user!.id

    await prisma.cycleLog.deleteMany({
      where: { id, userId },
    })

    return reply.send({ success: true })
  })
}
