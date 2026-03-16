import { FastifyInstance } from 'fastify'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { createEcoSchema } from '../schemas/eco.schema'
import { prisma } from '../db/prisma'
import { ecoWeekly } from '../services/AggregationService'

export async function ecoRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  // POST /api/eco
  app.post('/', async (request, reply) => {
    const body = validate(createEcoSchema, request.body)
    const action = await prisma.ecoAction.create({
      data: {
        userId: request.user!.id,
        category: body.category,
        type: body.type,
        impactKgCO2: body.impactKgCO2,
        ...(body.timestamp ? { timestamp: new Date(body.timestamp) } : {}),
      },
      select: { id: true, category: true, type: true, impactKgCO2: true, timestamp: true },
    })
    return reply.status(201).send({ success: true, data: action })
  })

  // GET /api/eco
  app.get('/', async (request, reply) => {
    const userId = request.user!.id
    const [data, weeklyAggregates] = await Promise.all([
      prisma.ecoAction.findMany({
        where: { userId },
        orderBy: { timestamp: 'desc' },
        take: 30,
        select: { id: true, category: true, type: true, impactKgCO2: true, timestamp: true },
      }),
      ecoWeekly(userId),
    ])
    return reply.send({ success: true, data, weeklyAggregates })
  })
}
