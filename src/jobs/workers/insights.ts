import { Worker, Job } from 'bullmq'
import { prisma } from '../../db/prisma'
import { insightsQueue } from '../queue'
import { computeFeatures } from '../../services/FeatureService'
import { refreshInsights } from '../../services/InsightService'
import { completeDueExperiments } from '../../services/ExperimentService'
import { deleteExpiredShares } from '../../services/HealthSummaryService'
import { flagsEnabled, refreshFlags } from '../../services/FlagService'
import { addDays, dayKey } from '../../utils/day'

// ─── Job payload types ────────────────────────────────────────────────────────

interface DispatchJob {
  type?: undefined
}

interface UserInsightsJob {
  userId: string
  today: string // local calendar day the run is for, YYYY-MM-DD
}

type InsightsJobData = DispatchJob | UserInsightsJob

/** Late logs and offline syncs can change the last few days, so they are recomputed every night */
const RECOMPUTE_DAYS = 3

// ─── Worker ───────────────────────────────────────────────────────────────────

// Use URL string for BullMQ — avoids ioredis version conflict
const workerConnection = { url: process.env.REDIS_URL as string }

export const insightsWorker = new Worker<InsightsJobData>(
  'insights',
  async (job: Job<InsightsJobData>) => {
    const data = job.data as UserInsightsJob

    if (!data.userId) {
      // ── Dispatcher: one job per user ───────────────────────────────────────
      const today = dayKey()
      const users = await prisma.user.findMany({ select: { id: true } })
      for (const user of users) {
        await insightsQueue.add(`user-insights-${user.id}-${today}`, { userId: user.id, today })
      }
      console.log(`[Insights] Dispatched ${users.length} user jobs for ${today}`)

      // Expired share links hold health data nobody can open any more
      const expired = await deleteExpiredShares()
      if (expired > 0) console.log(`[Insights] Deleted ${expired} expired summary links`)
      return
    }

    // ── Per user: features for the last few days, then the analysis ─────────
    // Logs ids and counts only — never health values or insight text
    await computeFeatures(data.userId, addDays(data.today, -RECOMPUTE_DAYS), addDays(data.today, -1))
    const summary = await refreshInsights(data.userId, data.today)
    const finished = await completeDueExperiments(data.userId, data.today)
    // Flags are only worked out once switched on (their wording is still in review)
    const flags = flagsEnabled() ? await refreshFlags(data.userId, data.today) : 0
    console.log(`[Insights] User ${data.userId}: ${summary.tested} tests, ${summary.active} active, ${finished} experiments finished, ${flags} flags`)
  },
  { connection: workerConnection },
)

insightsWorker.on('failed', (job, err) => {
  // First line only: database errors can quote the values they were given
  console.error(`[Insights] Job ${job?.id ?? 'unknown'} failed:`, err.message.split('\n')[0].slice(0, 200))
})
