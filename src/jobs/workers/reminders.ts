import { Worker } from 'bullmq'
import { runReminders } from '../../services/ReminderService'

const workerConnection = { url: process.env.REDIS_URL as string }

// Every 5 minutes: bedtime reminders and "good morning, log your wake-up"
// as phone notifications (see ReminderService and utils/reminders)
export const remindersWorker = new Worker(
  'reminders',
  async () => {
    const { bedtime, wake } = await runReminders()
    if (bedtime || wake) console.log(`[Reminders] Sent ${bedtime} bedtime, ${wake} morning`)
  },
  { connection: workerConnection },
)

remindersWorker.on('failed', (job, err) => {
  console.error(`[Reminders] Job ${job?.id ?? 'unknown'} failed:`, err.message)
})
