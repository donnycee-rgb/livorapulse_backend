import { Queue } from 'bullmq'

if (!process.env.REDIS_URL) {
  throw new Error('REDIS_URL environment variable is not set')
}

// Pass the URL string directly — avoids ioredis version conflicts between
// the top-level ioredis and BullMQ's bundled ioredis
const connection = { url: process.env.REDIS_URL }

/**
 * Queue for nightly per-user daily score computation.
 */
export const dailySummaryQueue = new Queue('daily-summary', {
  connection,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 50,
  },
})

/**
 * Queue for hourly streak tracking across all users.
 */
export const streaksQueue = new Queue('streaks', {
  connection,
  defaultJobOptions: {
    removeOnComplete: 50,
    removeOnFail: 20,
  },
})

/**
 * Register the repeatable cron jobs.
 * BullMQ v5 uses `pattern` instead of `cron` in RepeatOptions.
 */
export async function registerRepeatableJobs(): Promise<void> {
  await dailySummaryQueue.add(
    'dispatch-daily-summaries',
    {},
    { repeat: { pattern: '0 0 * * *' }, jobId: 'nightly-daily-summary' },
  )

  await streaksQueue.add(
    'update-all-streaks',
    {},
    { repeat: { pattern: '0 * * * *' }, jobId: 'hourly-streaks' },
  )
}