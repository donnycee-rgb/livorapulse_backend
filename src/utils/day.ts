// ─── Calendar-day helpers in the app's timezone ─────────────────────────────
// Servers run in UTC, but a "day" for our users starts at local midnight.
// Splitting days at UTC midnight would put anything logged between 00:00 and
// 03:00 in Nairobi into the previous day.

export const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Africa/Nairobi'

const keyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** YYYY-MM-DD of the given instant, in the app timezone */
export function dayKey(date: Date = new Date()): string {
  return keyFormatter.format(date)
}

/** Minutes the app timezone is ahead of UTC at the given instant (Nairobi: +180) */
function offsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIMEZONE,
    hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(at)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return Math.round((asUtc - at.getTime()) / 60000)
}

/** UTC instant of local midnight at the start of the given YYYY-MM-DD */
export function startOfDay(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  const utcMidnight = new Date(Date.UTC(y, m - 1, d))
  return new Date(utcMidnight.getTime() - offsetMinutes(utcMidnight) * 60000)
}

/** Start (inclusive) and end (exclusive) instants of a local calendar day */
export function dayBounds(dateOrKey: Date | string = new Date()): { key: string; start: Date; end: Date } {
  const key = typeof dateOrKey === 'string' ? dateOrKey : dayKey(dateOrKey)
  const start = startOfDay(key)
  const end = startOfDay(addDays(key, 1))
  return { key, start, end }
}

/** Shift a YYYY-MM-DD key by whole days */
export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

/** Start of the local day `days` days before today (0 = today) */
export function daysAgoStart(days: number): Date {
  return startOfDay(addDays(dayKey(), -days))
}

export function isDayKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}
