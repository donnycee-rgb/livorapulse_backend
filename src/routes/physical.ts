import { FastifyInstance } from 'fastify'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { createPhysicalSchema } from '../schemas/physical.schema'
import { prisma } from '../db/prisma'
import { physicalWeekly } from '../services/AggregationService'
import { dayBounds } from '../utils/day'

export async function physicalRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  // POST /api/activity/physical
  app.post('/', async (request, reply) => {
    const body = validate(createPhysicalSchema, request.body)
    const userId = request.user!.id
    const select = {
      id: true, steps: true, distanceKm: true, caloriesKcal: true,
      sleepMinutes: true, note: true, trail: true, timestamp: true,
    }

    // Sleep is one value per night. Changing it in the app replaces today's
    // sleep entry instead of adding another one (7 h then 8 h ≠ 15 h).
    const isSleepOnly = body.sleepMinutes > 0 && body.steps === 0 && body.distanceKm === 0
    if (isSleepOnly) {
      const { start, end } = dayBounds(body.timestamp ? new Date(body.timestamp) : new Date())
      const existing = await prisma.physicalActivityEntry.findFirst({
        where: { userId, timestamp: { gte: start, lt: end }, steps: 0, distanceKm: 0, sleepMinutes: { gt: 0 } },
        orderBy: { timestamp: 'desc' },
        select: { id: true },
      })
      if (existing) {
        const entry = await prisma.physicalActivityEntry.update({
          where: { id: existing.id },
          data: { sleepMinutes: body.sleepMinutes },
          select,
        })
        return reply.send({ success: true, data: entry })
      }
    }

    const entry = await prisma.physicalActivityEntry.create({
      data: {
        userId,
        steps: body.steps,
        distanceKm: body.distanceKm,
        caloriesKcal: body.caloriesKcal,
        sleepMinutes: body.sleepMinutes,
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
        },
      }),
      physicalWeekly(userId),
    ])
    return reply.send({ success: true, data, weeklyAggregates })
  })
}