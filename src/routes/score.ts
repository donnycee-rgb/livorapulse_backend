import { FastifyInstance } from 'fastify'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { dailyScoreQuerySchema } from '../schemas/score.schema'
import { computeDailyScore, weightedScore } from '../services/ScoreService'
import { getStreak, getStreakMultiplier } from '../services/StreakService'
import { prisma } from '../db/prisma'
import { dayKey, daysAgoStart } from '../utils/day'

export async function scoreRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  // GET /api/score/daily?date=YYYY-MM-DD — date is a local (Nairobi) calendar day; defaults to today
  app.get('/daily', async (request, reply) => {
    const query = validate(dailyScoreQuerySchema, request.query)
    const result = await computeDailyScore(request.user!.id, query.date ?? dayKey())
    return reply.send({ success: true, ...result })
  })

  // GET /api/score/streak — consecutive days with any log, calculated from the database
  app.get('/streak', async (request, reply) => {
    const streak = await getStreak(request.user!.id)
    return reply.send({ success: true, data: { streak, multiplier: getStreakMultiplier(streak) } })
  })

  // GET /api/score/history?days=30 — the scores that were saved each day
  app.get('/history', async (request, reply) => {
    const query = request.query as Record<string, string>
    const numDays = Math.min(parseInt(query.days ?? '30', 10) || 30, 90)

    const summaries = await prisma.dailySummary.findMany({
      where: { userId: request.user!.id, date: { gte: daysAgoStart(numDays) } },
      orderBy: { updatedAt: 'asc' },
      select: {
        date: true,
        score: true,
        physicalScore: true,
        digitalScore: true,
        productivityScore: true,
        moodScore: true,
        ecoScore: true,
        nutritionScore: true,
      },
    })

    // Older rows were keyed at UTC midnight and newer ones at local midnight —
    // both map to the same local day, and the most recently updated row wins.
    const byDay = new Map<string, number>()
    for (const s of summaries) {
      const parts = [s.physicalScore, s.digitalScore, s.productivityScore, s.moodScore, s.ecoScore, s.nutritionScore]
      if (s.score !== null) {
        byDay.set(dayKey(s.date), s.score)
      } else if (parts.some((p) => p !== null)) {
        // Very old rows saved before the score column existed
        byDay.set(dayKey(s.date), weightedScore({
          physical: s.physicalScore ?? 0,
          digital: s.digitalScore ?? 0,
          productivity: s.productivityScore ?? 0,
          mood: s.moodScore ?? 0,
          eco: s.ecoScore ?? 0,
          nutrition: s.nutritionScore ?? 0,
        }))
      }
      // A day with no score and nothing logged has nothing to show
    }

    const data = Array.from(byDay, ([date, score]) => ({ date, score }))
      .sort((a, b) => a.date.localeCompare(b.date))
    return reply.send({ success: true, data })
  })
}
