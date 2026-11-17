import { prisma } from '../db/prisma'
import { bedtimeDue, toHHMM, wakeDue } from '../utils/reminders'
import { pushReady, sendToUser } from './PushService'

// ─── Sleep reminders: one pass (the job calls this every 5 minutes) ──────────

export async function runReminders(now = new Date()): Promise<{ bedtime: number; wake: number }> {
  if (!pushReady()) return { bedtime: 0, wake: 0 }
  // Only people with a phone that allows notifications and something switched on
  const rows = await prisma.reminderSettings.findMany({
    where: {
      user: { pushSubscriptions: { some: {} } },
      OR: [{ bedtimeMinutes: { not: null } }, { sleepStartedAt: { not: null } }],
    },
  })
  let bedtime = 0
  let wake = 0
  for (const r of rows) {
    const night = bedtimeDue(r, now)
    if (night) {
      // Marked first, so a slow or failed send never repeats the same night
      await prisma.reminderSettings.update({ where: { userId: r.userId }, data: { bedtimeSentOn: night } })
      const n = await sendToUser(r.userId, {
        title: 'Time to wind down',
        body: `It's ${toHHMM(r.bedtimeMinutes!)}. Put the phone away soon, and tap "Going to sleep" when you're in bed.`,
        url: '/physical?tab=sleep',
        tag: 'bedtime',
        actions: [{ action: 'sleep-start', title: 'Going to sleep', url: '/physical?sleep=start' }],
      })
      if (n) bedtime++
    }
    if (wakeDue(r, now)) {
      await prisma.reminderSettings.update({ where: { userId: r.userId }, data: { wakeSentFor: r.sleepStartedAt } })
      const n = await sendToUser(r.userId, {
        title: 'Good morning',
        body: 'Tap to log what time you woke up. It takes a second.',
        url: '/physical?sleep=wake',
        tag: 'wake',
        actions: [{ action: 'sleep-wake', title: "I'm awake", url: '/physical?sleep=wake' }],
      })
      if (n) wake++
    }
  }
  return { bedtime, wake }
}
