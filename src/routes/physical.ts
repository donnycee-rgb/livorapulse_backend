import { FastifyInstance } from 'fastify'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { createPhysicalSchema } from '../schemas/physical.schema'
import { prisma } from '../db/prisma'
import { physicalWeekly } from '../services/AggregationService'
import { dayBounds } from '../utils/day'
import { activityValue, type ActivityType } from '../utils/activities'

export async function physicalRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  // POST /api/activity/physical
  app.post('/', async (request, reply) => {
    const body = validate(createPhysicalSchema, request.body)
    const userId = request.user!.id
    const select = {
      id: true, steps: true, distanceKm: true, caloriesKcal: true,
      sleepMinutes: true, note: true, trail: true, timestamp: true,
      sleepType: true, activityType: true, durationMin: true, stepEquivalent: true,
      sleepStart: true, sleepEnd: true,
    }

    // Sleep logged with times: the minutes come from the times, and it counts
    // for the day the person woke up
    const times = body.sleepStart && body.sleepEnd ? { sleepStart: new Date(body.sleepStart), sleepEnd: new Date(body.sleepEnd) } : null
    if (times) {
      body.sleepMinutes = Math.round((times.sleepEnd.getTime() - times.sleepStart.getTime()) / 60000)
      body.timestamp = body.sleepEnd
    }

    // A night logged with times ends any "Going to sleep" the reminders know about
    if (times && body.sleepType !== 'nap') {
      await prisma.reminderSettings.updateMany({ where: { userId, sleepStartedAt: { not: null } }, data: { sleepStartedAt: null } })
    }

    // Last night's sleep is one value per day: setting it again corrects it
    // (7 h then 8 h ≠ 15 h). Naps are separate and each one adds.
    const isSleepOnly = body.sleepMinutes > 0 && body.steps === 0 && body.distanceKm === 0 && !body.activityType
    const sleepType = isSleepOnly ? (body.sleepType ?? 'night') : null
    if (sleepType === 'night') {
      const { start, end } = dayBounds(body.timestamp ? new Date(body.timestamp) : new Date())
      const existing = await prisma.physicalActivityEntry.findFirst({
        where: {
          userId, timestamp: { gte: start, lt: end }, steps: 0, distanceKm: 0, sleepMinutes: { gt: 0 },
          OR: [{ sleepType: 'night' }, { sleepType: null }],
        },
        orderBy: { timestamp: 'desc' },
        select: { id: true },
      })
      if (existing) {
        const entry = await prisma.physicalActivityEntry.update({
          where: { id: existing.id },
          data: { sleepMinutes: body.sleepMinutes, sleepStart: times?.sleepStart ?? null, sleepEnd: times?.sleepEnd ?? null },
          select,
        })
        return reply.send({ success: true, data: entry })
      }
    }

    // Another activity: calories and step-goal credit come from its type,
    // duration and the person's weight, not from a number typed in the app
    let activity: { activityType: string; durationMin: number; caloriesKcal: number; stepEquivalent: number } | null = null
    if (body.activityType && body.durationMin) {
      const profile = await prisma.userProfile.findUnique({ where: { userId }, select: { weightKg: true } })
      const value = activityValue(body.activityType as ActivityType, body.durationMin, profile?.weightKg)
      activity = { activityType: body.activityType, durationMin: body.durationMin, ...value }
    }

    const entry = await prisma.physicalActivityEntry.create({
      data: {
        userId,
        steps: body.steps,
        distanceKm: body.distanceKm,
        caloriesKcal: activity ? activity.caloriesKcal : body.caloriesKcal,
        sleepMinutes: body.sleepMinutes,
        sleepType,
        ...(sleepType && times ? times : {}),
        ...(activity ? { activityType: activity.activityType, durationMin: activity.durationMin, stepEquivalent: activity.stepEquivalent } : {}),
        note: body.note ?? null,
        trail: body.trail ? body.trail : undefined,
        ...(body.timestamp ? { timestamp: new Date(body.timestamp) } : {}),
      },
      select,
    })
    return reply.status(201).send({ success: true, data: entry })
  })

  // GET /api/activity/physical
  app.get('/', async (request, reply) => {
    const userId = request.user!.id
    const [data, weeklyAggregates] = await Promise.all([
      prisma.physicalActivityEntry.findMany({
        where: { userId },
        orderBy: { timestamp: 'desc' },
        take: 30,
        select: {
          id: true,
          steps: true,
          distanceKm: true,
          caloriesKcal: true,
          sleepMinutes: true,
          note: true,
          trail: true,
          timestamp: true,
          sleepType: true,
          activityType: true,
          durationMin: true,
          stepEquivalent: true,
          sleepStart: true,
          sleepEnd: true,
        },
      }),
      physicalWeekly(userId),
    ])
    return reply.send({ success: true, data, weeklyAggregates })
  })
}