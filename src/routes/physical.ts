import { FastifyInstance } from 'fastify'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { createPhysicalSchema } from '../schemas/physical.schema'
import { prisma } from '../db/prisma'
import { physicalWeekly } from '../services/AggregationService'

export async function physicalRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  // POST /api/activity/physical
  app.post('/', async (request, reply) => {
    const body = validate(createPhysicalSchema, request.body)
    const entry = await prisma.physicalActivityEntry.create({
      data: {
        userId: request.user!.id,
        steps: body.steps,
        distanceKm: body.distanceKm,
        caloriesKcal: body.caloriesKcal,
        sleepMinutes: body.sleepMinutes,
        note: body.note ?? null,
        trail: body.trail ? body.trail : undefined,
        ...(body.timestamp ? { timestamp: new Date(body.timestamp) } : {}),
      },
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