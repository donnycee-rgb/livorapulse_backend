import { FastifyInstance } from 'fastify'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { createDigitalSchema } from '../schemas/digital.schema'
import { prisma } from '../db/prisma'
import { digitalWeekly } from '../services/AggregationService'

export async function digitalRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  // POST /api/activity/digital
  app.post('/', async (request, reply) => {
    const body = validate(createDigitalSchema, request.body)
    const entry = await prisma.digitalUsageEntry.create({
      data: {
        userId: request.user!.id,
        screenTimeMinutes: body.screenTimeMinutes,
        categoryBreakdown: body.categoryBreakdown,
        ...(body.date ? { date: new Date(body.date) } : {}),
      },
      select: {
        id: true,
        screenTimeMinutes: true,
        categoryBreakdown: true,
        date: true,
      },
    })
    return reply.status(201).send({ success: true, data: entry })
  })

  // GET /api/activity/digital
  app.get('/', async (request, reply) => {
    const userId = request.user!.id
    const [data, weeklyAggregates] = await Promise.all([
      prisma.digitalUsageEntry.findMany({
        where: { userId },
        orderBy: { date: 'desc' },
        take: 30,
        select: {
          id: true,
          screenTimeMinutes: true,
          categoryBreakdown: true,
          date: true,
        },
      }),
      digitalWeekly(userId),
    ])
    return reply.send({ success: true, data, weeklyAggregates })
  })
}
