import { Worker } from 'bullmq'
import { prisma } from '../../db/prisma'
import { computeStreak } from '../../services/StreakService'

// Use URL string for BullMQ — avoids ioredis version conflict
const workerConnection = { url: process.env.REDIS_URL as string }

// Streaks are calculated from the logs themselves (see StreakService); this job
// just keeps the cached value fresh for every user.
export const streakWorker = new Worker(
  'streaks',
  async () => {
    const users = await prisma.user.findMany({ select: { id: true } })
    for (const user of users) {
      await computeStreak(user.id)
    }
    console.log(`[Streaks] Refreshed streaks for ${users.length} users`)
  },
  { connection: workerConnection },
)

streakWorker.on('failed', (job, err) => {
  console.error(`[Streaks] Job ${job?.id ?? 'unknown'} failed:`, err.message)
})
