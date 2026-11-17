// ─── When to send sleep reminders ───────────────────────────────────────────
// The reminder job runs every 5 minutes and asks these two questions for each
// person. Pure functions: no database, no clock of their own.

/** Is this an IANA time zone the server understands (e.g. "Africa/Nairobi")? */
export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** The local calendar date (YYYY-MM-DD) and minutes after local midnight */
export function localClock(at: Date, tz: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) }
}

export const toMinutes = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }
export const toHHMM = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

/** How late a reminder may still go out (the job runs every 5 minutes; a slow run shouldn't skip a night) */
export const WINDOW_MIN = 20

export type ReminderState = {
  timezone: string
  bedtimeMinutes: number | null
  wakeReminder: boolean
  sleepStartedAt: Date | null
  bedtimeSentOn: string | null
  wakeSentFor: Date | null
}

/**
 * Bedtime: at the chosen time (or up to WINDOW_MIN after), once a night,
 * and not if the person has already tapped "Going to sleep". Returns the
 * night it's for (the local date of the bedtime), or null.
 */
export function bedtimeDue(s: ReminderState, now: Date): string | null {
  if (s.bedtimeMinutes === null || s.sleepStartedAt) return null
  const { date, minutes } = localClock(now, s.timezone)
  const since = (minutes - s.bedtimeMinutes + 1440) % 1440
  if (since >= WINDOW_MIN) return null
  // A 23:55 bedtime reminded at 00:05 belongs to the night before
  const night = minutes < s.bedtimeMinutes ? localClock(new Date(now.getTime() - since * 60000), s.timezone).date : date
  return s.bedtimeSentOn === night ? null : night
}

/** Morning: a sleep has been running 7½ hours, it's 05:00–11:59 there, and this sleep hasn't been reminded yet */
export function wakeDue(s: ReminderState, now: Date): boolean {
  if (!s.wakeReminder || !s.sleepStartedAt) return false
  if (s.wakeSentFor && s.wakeSentFor.getTime() === s.sleepStartedAt.getTime()) return false
  const hours = (now.getTime() - s.sleepStartedAt.getTime()) / 3600000
  if (hours < 7.5 || hours > 20) return false // too soon, or a tap that was forgotten long ago
  const { minutes } = localClock(now, s.timezone)
  return minutes >= 5 * 60 && minutes < 12 * 60
}
