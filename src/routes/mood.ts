import { FastifyInstance } from 'fastify'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { createMoodSchema } from '../schemas/mood.schema'
import { prisma } from '../db/prisma'
import { moodWeekly } from '../services/AggregationService'

export async function moodRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  // POST /api/mood
  app.post('/', async (request, reply) => {
    const body = validate(createMoodSchema, request.body)
    const log = await prisma.moodLog.create({
      data: {
        userId: request.user!.id,
        emoji: body.emoji,
        stressScore: body.stressScore,
        note: body.note,
      },
      select: { id: true, emoji: true, stressScore: true, note: true, timestamp: true },
    })
    return reply.status(201).send({ success: true, data: log })
  })

  // GET /api/mood
  app.get('/', async (request, reply) => {
    const userId = request.user!.id
    const [data, weeklyAggregates] = await Promise.all([
      prisma.moodLog.findMany({
        where: { userId },
        orderBy: { timestamp: 'desc' },
        take: 30,
        select: { id: true, emoji: true, stressScore: true, note: true, timestamp: true },
      }),
      moodWeekly(userId),
    ])
    return reply.send({ success: true, data, weeklyAggregates })
  })
}
