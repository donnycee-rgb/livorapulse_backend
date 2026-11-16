import { FastifyInstance } from 'fastify'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { createMoodSchema } from '../schemas/mood.schema'
import { prisma } from '../db/prisma'
import { moodWeekly } from '../services/AggregationService'

const MERGE_WINDOW_MS = 30 * 60 * 1000

export async function moodRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  // POST /api/mood
  // Tapping a different emoji or nudging the stress slider shortly after a
  // check-in updates that check-in instead of adding another one — otherwise
  // a few taps would stack up entries and skew the day's average.
  app.post('/', async (request, reply) => {
    const body = validate(createMoodSchema, request.body)
    const userId = request.user!.id
    const select = { id: true, emoji: true, stressScore: true, note: true, timestamp: true }

    // A check-in saved offline carries the time it was made
    const at = body.timestamp ? new Date(body.timestamp) : new Date()
    const recent = await prisma.moodLog.findFirst({
      where: { userId, timestamp: { gte: new Date(at.getTime() - MERGE_WINDOW_MS), lte: new Date(at.getTime() + MERGE_WINDOW_MS) } },
      orderBy: { timestamp: 'desc' },
      select: { id: true },
    })

    if (recent) {
      const log = await prisma.moodLog.update({
        where: { id: recent.id },
        data: {
          emoji: body.emoji,
          stressScore: body.stressScore,
          ...(body.note !== undefined && { note: body.note }),
        },
        select,
      })
      return reply.send({ success: true, data: log })
    }

    const log = await prisma.moodLog.create({
      data: { userId, emoji: body.emoji, stressScore: body.stressScore, note: body.note, timestamp: at },
      select,
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
