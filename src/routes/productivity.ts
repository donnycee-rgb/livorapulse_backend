import { FastifyInstance } from 'fastify'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { createProductivitySchema } from '../schemas/productivity.schema'
import { prisma } from '../db/prisma'
import { productivityWeekly } from '../services/AggregationService'

export async function productivityRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  // POST /api/productivity/session
  app.post('/', async (request, reply) => {
    const body = validate(createProductivitySchema, request.body)
    const session = await prisma.productivitySession.create({
      data: {
        userId: request.user!.id,
        kind: body.kind,
        label: body.label,
        startedAt: new Date(body.startedAt),
        endedAt: new Date(body.endedAt),
        durationSec: body.durationSec,
      },
      select: {
        id: true,
        kind: true,
        label: true,
        startedAt: true,
        endedAt: true,
        durationSec: true,
      },
    })
    return reply.status(201).send({ success: true, data: session })
  })

  // GET /api/productivity/session
  app.get('/', async (request, reply) => {
    const userId = request.user!.id
    const [data, weeklyAggregates] = await Promise.all([
      prisma.productivitySession.findMany({
        where: { userId },
        orderBy: { startedAt: 'desc' },
        take: 30,
        select: {
          id: true,
          kind: true,
          label: true,
          startedAt: true,
          endedAt: true,
          durationSec: true,
        },
      }),
      productivityWeekly(userId),
    ])
    return reply.send({ success: true, data, weeklyAggregates })
  })
}
