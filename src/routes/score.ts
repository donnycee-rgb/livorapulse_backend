import { FastifyInstance } from 'fastify'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { dailyScoreQuerySchema } from '../schemas/score.schema'
import { computeDailyScore } from '../services/ScoreService'
import { prisma } from '../db/prisma'
import { redis } from '../db/redis'

function streakKey(userId: string): string {
  return `streak:${userId}`
}

export async function scoreRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  // GET /api/score/daily?date=YYYY-MM-DD
  app.get('/daily', async (request, reply) => {
    const query = validate(dailyScoreQuerySchema, request.query)
    const date = query.date ? new Date(query.date) : new Date()
    const result = await computeDailyScore(request.user!.id, date)
    return reply.send({ success: true, ...result })
  })

  // GET /api/score/streak — reads from Redis (computed by BullMQ streak worker)
  app.get('/streak', async (request, reply) => {
    try {
      const raw = await redis.get(streakKey(request.user!.id))
      const streak = raw ? parseInt(raw, 10) : 0
      return reply.send({ success: true, data: { streak } })
    } catch {
      return reply.send({ success: true, data: { streak: 0 } })
    }
  })

  // GET /api/score/history?days=30
  app.get('/history', async (request, reply) => {
    const query = request.query as Record<string, string>
    const numDays = Math.min(parseInt(query.days ?? '30', 10) || 30, 90)

    const from = new Date()
    from.setDate(from.getDate() - numDays)
    from.setHours(0, 0, 0, 0)

    const summaries = await prisma.dailySummary.findMany({
      where: { userId: request.user!.id, date: { gte: from } },
      orderBy: { date: 'asc' },
      select: {
        date: true,
        physicalScore: true,
        digitalScore: true,
        productivityScore: true,
        moodScore: true,
        ecoScore: true,
      },
    })

    return reply.send({
      success: true,
      data: summaries.map((s) => ({
        date: s.date.toISOString().split('T')[0],
        score: Math.round(
          0.26 * (s.physicalScore ?? 0) +
          0.20 * (s.digitalScore ?? 0) +
          0.22 * (s.productivityScore ?? 0) +
          0.16 * (s.moodScore ?? 0) +
          0.16 * (s.ecoScore ?? 0),
        ),
      })),
    })
  })
}