import { Worker, Job } from 'bullmq'
import { prisma } from '../../db/prisma'
import { dailySummaryQueue } from '../queue'
import { computeDailyScore } from '../../services/ScoreService'
import { addDays, dayKey } from '../../utils/day'

// ─── Job payload types ────────────────────────────────────────────────────────

interface DispatchJob {
  type?: undefined
}

interface UserSummaryJob {
  userId: string
  date: string // local calendar day, YYYY-MM-DD
}

type DailySummaryJobData = DispatchJob | UserSummaryJob

// ─── Worker ───────────────────────────────────────────────────────────────────

// Use URL string for BullMQ — avoids ioredis version conflict
const workerConnection = { url: process.env.REDIS_URL as string }

export const dailySummaryWorker = new Worker<DailySummaryJobData>(
  'daily-summary',
  async (job: Job<DailySummaryJobData>) => {
    const data = job.data as UserSummaryJob

    if (!data.userId) {
      // ── Dispatcher job: enqueue one job per user for yesterday ──────────────
      // Runs just after local midnight, so "yesterday" is the day that just ended
      const dateStr = addDays(dayKey(), -1)

      const users = await prisma.user.findMany({ select: { id: true } })

      for (const user of users) {
        await dailySummaryQueue.add(
          `user-summary-${user.id}-${dateStr}`,
          { userId: user.id, date: dateStr },
        )
      }

      console.log(`[DailySummary] Dispatched ${users.length} user jobs for ${dateStr}`)
      return
    }

    // ── Per-user job: compute and upsert score ───────────────────────────────
    await computeDailyScore(data.userId, data.date)
    console.log(`[DailySummary] Processed user ${data.userId} for ${data.date}`)
  },
  { connection: workerConnection },
)

dailySummaryWorker.on('failed', (job, err) => {
  console.error(`[DailySummary] Job ${job?.id ?? 'unknown'} failed:`, err.message)
})