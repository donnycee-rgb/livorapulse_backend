import { Queue } from 'bullmq'
import { createRedisConnection } from '../db/redis'

// Each queue uses its own dedicated Redis connection (BullMQ requirement)
const dailySummaryConnection = createRedisConnection()
const streaksConnection = createRedisConnection()

/**
 * Queue for nightly per-user daily score computation.
 * A repeatable dispatcher job fires at midnight UTC and enqueues
 * individual { userId, date } jobs for every user.
 */
export const dailySummaryQueue = new Queue('daily-summary', {
  connection: dailySummaryConnection,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 50,
  },
})

/**
 * Queue for hourly streak tracking across all users.
 */
export const streaksQueue = new Queue('streaks', {
  connection: streaksConnection,
  defaultJobOptions: {
    removeOnComplete: 50,
    removeOnFail: 20,
  },
})

/**
 * Register the repeatable cron jobs.
 * Call once at server startup — BullMQ is idempotent for repeatable jobs
 * (adding the same job with the same key is a no-op).
 */
export async function registerRepeatableJobs(): Promise<void> {
  await dailySummaryQueue.add(
    'dispatch-daily-summaries',
    {},
    { repeat: { cron: '0 0 * * *' }, jobId: 'nightly-daily-summary' },
  )

  await streaksQueue.add(
    'update-all-streaks',
    {},
    { repeat: { cron: '0 * * * *' }, jobId: 'hourly-streaks' },
  )
}
