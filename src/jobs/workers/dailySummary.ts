import { Worker, Job } from 'bullmq'
import { prisma } from '../../db/prisma'
import { dailySummaryQueue } from '../queue'
import { computeDailyScore } from '../../services/ScoreService'

// ─── Job payload types ────────────────────────────────────────────────────────

interface DispatchJob {
  type?: undefined
}

interface UserSummaryJob {
  userId: string
  date: string // ISO date string YYYY-MM-DD
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
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      const dateStr = yesterday.toISOString().slice(0, 10)

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
    const date = new Date(data.date)
    await computeDailyScore(data.userId, date)
    console.log(`[DailySummary] Processed user ${data.userId} for ${data.date}`)
  },
  { connection: workerConnection },
)

dailySummaryWorker.on('failed', (job, err) => {
  console.error(`[DailySummary] Job ${job?.id ?? 'unknown'} failed:`, err.message)
})