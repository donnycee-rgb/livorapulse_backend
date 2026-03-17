import { Worker } from 'bullmq'
import { redis } from '../../db/redis'
import { prisma } from '../../db/prisma'

// Use URL string for BullMQ — avoids ioredis version conflict
const workerConnection = { url: process.env.REDIS_URL as string }

async function hasActivityToday(userId: string): Promise<boolean> {
  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)

  const [physical, digital, productivity, mood, eco] = await Promise.all([
    prisma.physicalActivityEntry.count({ where: { userId, timestamp: { gte: todayStart } } }),
    prisma.digitalUsageEntry.count({ where: { userId, date: { gte: todayStart } } }),
    prisma.productivitySession.count({ where: { userId, startedAt: { gte: todayStart } } }),
    prisma.moodLog.count({ where: { userId, timestamp: { gte: todayStart } } }),
    prisma.ecoAction.count({ where: { userId, timestamp: { gte: todayStart } } }),
  ])

  return physical + digital + productivity + mood + eco > 0
}

async function hadActivityYesterday(userId: string): Promise<boolean> {
  const yesterdayStart = new Date()
  yesterdayStart.setDate(yesterdayStart.getDate() - 1)
  yesterdayStart.setUTCHours(0, 0, 0, 0)
  const yesterdayEnd = new Date(yesterdayStart)
  yesterdayEnd.setUTCHours(23, 59, 59, 999)

  const [physical, digital, productivity, mood, eco] = await Promise.all([
    prisma.physicalActivityEntry.count({
      where: { userId, timestamp: { gte: yesterdayStart, lte: yesterdayEnd } },
    }),
    prisma.digitalUsageEntry.count({
      where: { userId, date: { gte: yesterdayStart, lte: yesterdayEnd } },
    }),
    prisma.productivitySession.count({
      where: { userId, startedAt: { gte: yesterdayStart, lte: yesterdayEnd } },
    }),
    prisma.moodLog.count({
      where: { userId, timestamp: { gte: yesterdayStart, lte: yesterdayEnd } },
    }),
    prisma.ecoAction.count({
      where: { userId, timestamp: { gte: yesterdayStart, lte: yesterdayEnd } },
    }),
  ])

  return physical + digital + productivity + mood + eco > 0
}

export const streakWorker = new Worker(
  'streaks',
  async () => {
    const users = await prisma.user.findMany({ select: { id: true } })

    for (const user of users) {
      const key = `streak:${user.id}`
      const activeToday = await hasActivityToday(user.id)

      if (activeToday) {
        const currentStreak = parseInt((await redis.get(key)) ?? '0', 10)
        const markerKey = `streak_marked:${user.id}:${new Date().toISOString().slice(0, 10)}`
        const alreadyMarked = await redis.exists(markerKey)
        if (!alreadyMarked) {
          const keptStreak = await hadActivityYesterday(user.id)
          const newStreak = keptStreak ? currentStreak + 1 : 1
          await redis.set(key, newStreak)
          await redis.set(markerKey, '1', 'EX', 86400)
        }
      } else {
        const keptYesterday = await hadActivityYesterday(user.id)
        if (!keptYesterday) {
          await redis.set(key, 0)
        }
      }
    }

    console.log(`[Streaks] Processed streaks for ${users.length} users`)
  },
  { connection: workerConnection },
)

streakWorker.on('failed', (job, err) => {
  console.error(`[Streaks] Job ${job?.id ?? 'unknown'} failed:`, err.message)
})