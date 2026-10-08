import { Queue } from 'bullmq'
import { APP_TIMEZONE } from '../utils/day'

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
 * Register the scheduled jobs. Schedulers are upserted by id, so changing a
 * schedule here replaces the old one instead of adding a second copy.
 */
export async function registerRepeatableJobs(): Promise<void> {
  // Remove the schedules registered by earlier versions (UTC midnight / old ids)
  await dailySummaryQueue
    .removeRepeatable('dispatch-daily-summaries', { pattern: '0 0 * * *' }, 'nightly-daily-summary')
    .catch(() => false)
  await streaksQueue
    .removeRepeatable('update-all-streaks', { pattern: '0 * * * *' }, 'hourly-streaks')
    .catch(() => false)

  // Five past local midnight — finalise yesterday's score for every user
  await dailySummaryQueue.upsertJobScheduler(
    'nightly-daily-summary',
    { pattern: '5 0 * * *', tz: APP_TIMEZONE },
    { name: 'dispatch-daily-summaries', data: {} },
  )
  // Hourly — refresh the cached streaks
  await streaksQueue.upsertJobScheduler(
    'hourly-streaks',
    { pattern: '0 * * * *', tz: APP_TIMEZONE },
    { name: 'update-all-streaks', data: {} },
  )
}
