import { FastifyInstance } from 'fastify'
import { authenticate } from '../middleware/authenticate'
import { prisma } from '../db/prisma'
import { dayKey, startOfDay } from '../utils/day'
import { liveMoodForecast } from '../services/MoodForecast'

// Results of the nightly mood model (written by the Python job in ml/).
// The API only reads them.

const OUTCOME = 'mood'
/** Mood days a user needs before the model publishes anything for them (ml/livora_ml/job.py) */
const MIN_MOOD_DAYS = 5

export async function mlRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  // GET /api/ml/mood — what goes with a better mood for this user, and today's forecast
  app.get('/mood', async (request, reply) => {
    const userId = request.user!.id
    const today = dayKey()

    const [effects, prediction, lastRun, live] = await Promise.all([
      prisma.mlUserEffect.findMany({
        where: { userId, outcome: OUTCOME, claim: { in: ['personal', 'typical'] } },
        select: { feature: true, unit: true, mean: true, sd: true, probPositive: true, claim: true, nDays: true, updatedAt: true },
      }),
      prisma.mlPrediction.findUnique({
        where: { userId_date_outcome: { userId, date: startOfDay(today), outcome: OUTCOME } },
        select: { mean: true, lower: true, upper: true, nDays: true },
      }),
      prisma.mlModelRun.findFirst({
        where: { status: { in: ['succeeded', 'skipped'] } },
        orderBy: { startedAt: 'desc' },
        select: { status: true, finishedAt: true },
      }),
      // Re-forecast with today's logs (last night's sleep) when the user's model is saved
      liveMoodForecast(userId, today).catch((err) => {
        request.log.warn({ err }, 'live mood forecast failed; using the nightly one')
        return null
      }),
    ])

    // Personal patterns first, then the clearest ones (effect relative to its uncertainty)
    effects.sort((a, b) =>
      (a.claim === 'personal' ? 0 : 1) - (b.claim === 'personal' ? 0 : 1) ||
      Math.abs(b.mean / b.sd) - Math.abs(a.mean / a.sd))

    return reply.header('Cache-Control', 'no-store').send({
      success: true,
      data: {
        minMoodDays: MIN_MOOD_DAYS,
        moodDays: effects[0]?.nDays ?? prediction?.nDays ?? 0,
        effects: effects.map(({ nDays: _n, ...e }) => e),
        forecast: live
          ? { date: today, mean: live.mean, lower: live.lower, upper: live.upper, usesSleep: live.usesSleep }
          : prediction
            ? { date: today, mean: prediction.mean, lower: prediction.lower, upper: prediction.upper, usesSleep: false }
            : null,
        lastRun,
      },
    })
  })
}
