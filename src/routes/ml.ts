import { FastifyInstance } from 'fastify'
import { authenticate } from '../middleware/authenticate'
import { prisma } from '../db/prisma'
import { addDays, dayKey, startOfDay } from '../utils/day'
import { liveMoodForecast } from '../services/MoodForecast'

// Results of the nightly mood model (written by the Python job in ml/).
// The API only reads them.

const OUTCOME = 'mood'
/** Mood days a user needs before the model publishes anything for them (ml/livora_ml/job.py) */
const MIN_MOOD_DAYS = 5
/** The model reads this many days back (ml/livora_ml/job.py) */
const MODEL_WINDOW_DAYS = 180

export async function mlRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  // GET /api/ml/mood — what goes with a better mood for this user, and today's forecast
  app.get('/mood', async (request, reply) => {
    const userId = request.user!.id
    const today = dayKey()

    const [effects, prediction, lastRun, live, moodDays] = await Promise.all([
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
      // Days with mood logged, from the same daily table the model reads
      prisma.dailyFeatures.count({
        where: { userId, moodValue: { not: null }, date: { gte: startOfDay(addDays(today, -MODEL_WINDOW_DAYS)) } },
      }),
    ])

    // Why there's nothing to show yet, in a way the app can say plainly:
    // 'you' (more mood days needed), 'people' (the model learns from everyone
    // and is waiting for enough people), 'tonight' (ready, runs overnight)
    const waitingFor = effects.length > 0 ? null
      : moodDays < MIN_MOOD_DAYS ? 'you'
      : lastRun?.status === 'skipped' ? 'people'
      : 'tonight'

    // Personal patterns first, then the clearest ones (effect relative to its uncertainty)
    effects.sort((a, b) =>
      (a.claim === 'personal' ? 0 : 1) - (b.claim === 'personal' ? 0 : 1) ||
      Math.abs(b.mean / b.sd) - Math.abs(a.mean / a.sd))

    return reply.header('Cache-Control', 'no-store').send({
      success: true,
      data: {
        minMoodDays: MIN_MOOD_DAYS,
        moodDays,
        waitingFor,
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
