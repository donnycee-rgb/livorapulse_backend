// ─── Cycle maths from logged period days ─────────────────────────────────────
// The person marks each day of a period (with flow and symptoms). Everything
// else is worked out from those days, in date order:
// - a period is a run of logged days (a single missed day in the middle
//   doesn't split it),
// - a cycle length is the gap between two consecutive period starts,
// - predictions use the average of recent cycles, and a range as wide as
//   how much the cycles vary.
// Pure functions on YYYY-MM-DD keys (calendar days, no timezones).

export type Flow = 'spotting' | 'light' | 'medium' | 'heavy'
export const FLOWS: Flow[] = ['spotting', 'light', 'medium', 'heavy']

export type PeriodDayInput = { date: string; flow: string | null; symptoms: unknown; notes: string | null }

export type Period = {
  start: string
  end: string
  days: number
  /** The heaviest flow logged in the period */
  heaviestFlow: Flow | null
  symptoms: string[]
  notes: string[]
}

export const keyToDays = (k: string) => Math.round(Date.parse(`${k}T00:00:00Z`) / 86400000)
export const daysToKey = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10)
export const addDaysKey = (k: string, n: number) => daysToKey(keyToDays(k) + n)
export const daysBetweenKeys = (a: string, b: string) => keyToDays(b) - keyToDays(a)

/** Runs of logged days, oldest first. Up to one unlogged day inside a run keeps it one period. */
export function groupPeriods(days: PeriodDayInput[]): Period[] {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date))
  const periods: Period[] = []
  for (const d of sorted) {
    const last = periods[periods.length - 1]
    const symptoms = Array.isArray(d.symptoms) ? d.symptoms.filter((s): s is string => typeof s === 'string') : []
    const flow = FLOWS.includes(d.flow as Flow) ? (d.flow as Flow) : null
    if (last && daysBetweenKeys(last.end, d.date) <= 2) {
      last.end = d.date
      last.days = daysBetweenKeys(last.start, d.date) + 1
      if (flow && (!last.heaviestFlow || FLOWS.indexOf(flow) > FLOWS.indexOf(last.heaviestFlow))) last.heaviestFlow = flow
      for (const s of symptoms) if (!last.symptoms.includes(s)) last.symptoms.push(s)
      if (d.notes) last.notes.push(d.notes)
    } else {
      periods.push({ start: d.date, end: d.date, days: 1, heaviestFlow: flow, symptoms: [...symptoms], notes: d.notes ? [d.notes] : [] })
    }
  }
  return periods
}

/** Gaps between consecutive starts, oldest first; only 15–60 days are trusted as cycles */
export function cycleLengths(periods: Period[]): number[] {
  const out: number[] = []
  for (let i = 1; i < periods.length; i++) {
    const gap = daysBetweenKeys(periods[i - 1].start, periods[i].start)
    if (gap >= 15 && gap <= 60) out.push(gap)
  }
  return out
}

export type CycleStats = {
  /** Expected cycle length (days) */
  cycleLength: number
  /** Expected period length (days) */
  periodLength: number
  /** ± days around a predicted date */
  spread: number
  /** How many real cycles the averages come from (0 = the person's settings) */
  cyclesUsed: number
}

/**
 * Averages from the last 6 cycles (the one furthest from the mean dropped
 * once there are 4+), falling back to the person's settings. The spread is
 * the standard deviation, at least 1 day, at most 7; with fewer than 3 real
 * cycles it's 3 days, since there isn't enough to know better.
 */
export function cycleStats(periods: Period[], today: string, defaults: { cycleLength?: number | null; periodLength?: number | null }): CycleStats {
  let lengths = cycleLengths(periods).slice(-6)
  if (lengths.length >= 4) {
    const mean = lengths.reduce((s, v) => s + v, 0) / lengths.length
    let far = 0
    lengths.forEach((v, i) => { if (Math.abs(v - mean) > Math.abs(lengths[far] - mean)) far = i })
    lengths = lengths.filter((_, i) => i !== far)
  }
  // Period lengths from finished periods only (one still going isn't over yet)
  const finished = periods.filter((p) => daysBetweenKeys(p.end, today) >= 2).slice(-6).map((p) => p.days)

  const cycleLength = lengths.length ? Math.round(lengths.reduce((s, v) => s + v, 0) / lengths.length) : (defaults.cycleLength ?? 28)
  const periodLength = finished.length ? Math.round(finished.reduce((s, v) => s + v, 0) / finished.length) : (defaults.periodLength ?? 5)
  let spread = 3
  if (lengths.length >= 3) {
    const mean = lengths.reduce((s, v) => s + v, 0) / lengths.length
    const sd = Math.sqrt(lengths.reduce((s, v) => s + (v - mean) ** 2, 0) / lengths.length)
    spread = Math.min(7, Math.max(1, Math.round(sd)))
  }
  return { cycleLength, periodLength, spread, cyclesUsed: lengths.length }
}

export type Phase = 'menstrual' | 'follicular' | 'ovulation' | 'luteal'

export type CycleStatus = {
  lastPeriodStart: string
  dayOfCycle: number
  phase: Phase
  periodActive: boolean
  nextPeriodDate: string
  nextPeriodEarliest: string
  nextPeriodLatest: string
  daysUntilNextPeriod: number
  periodDueToday: boolean
  isLate: boolean
  daysLate: number
  ovulationDay: number
  fertileWindowStart: number
  fertileWindowEnd: number
}

/**
 * Where today falls. Ovulation is taken as 14 days before the next
 * expected period (the common estimate), the fertile window as the 5 days
 * before it plus the day itself. "Late" only after the latest date in the range.
 */
export function cycleStatus(periods: Period[], stats: CycleStats, today: string): CycleStatus | null {
  const last = periods[periods.length - 1]
  if (!last) return null
  const dayOfCycle = daysBetweenKeys(last.start, today) + 1
  const next = addDaysKey(last.start, stats.cycleLength)
  const latest = addDaysKey(next, stats.spread)
  const ovulationDay = Math.max(2, stats.cycleLength - 14)
  const fertileWindowStart = Math.max(ovulationDay - 5, 1)
  const periodActive = daysBetweenKeys(last.end, today) <= 1 && dayOfCycle <= last.days + 1 && dayOfCycle <= 10

  let phase: Phase
  if (periodActive || dayOfCycle <= Math.max(last.days, 1)) phase = 'menstrual'
  else if (dayOfCycle < ovulationDay - 1) phase = 'follicular'
  else if (dayOfCycle <= ovulationDay + 1) phase = 'ovulation'
  else phase = 'luteal'

  const daysLate = Math.max(0, daysBetweenKeys(latest, today))
  return {
    lastPeriodStart: last.start,
    dayOfCycle,
    phase,
    periodActive,
    nextPeriodDate: next,
    nextPeriodEarliest: addDaysKey(next, -stats.spread),
    nextPeriodLatest: latest,
    daysUntilNextPeriod: Math.max(0, daysBetweenKeys(today, next)),
    periodDueToday: today === next,
    isLate: daysLate > 0,
    daysLate,
    ovulationDay,
    fertileWindowStart,
    fertileWindowEnd: ovulationDay,
  }
}

export type DayMark = 'period' | 'predicted-period' | 'fertile' | 'ovulation'

/**
 * Calendar marks from `from` to `to` (inclusive): logged period days, and
 * for the cycle in progress and the next two, the predicted period and the
 * estimated fertile window. Past cycles are left plain: what's logged is
 * what happened.
 */
export function calendarMarks(periods: Period[], stats: CycleStats, loggedDays: Set<string>, from: string, to: string, today: string): Record<string, DayMark> {
  const marks: Record<string, DayMark> = {}
  const inRange = (k: string) => k >= from && k <= to
  for (const d of loggedDays) if (inRange(d)) marks[d] = 'period'
  const last = periods[periods.length - 1]
  if (!last) return marks
  for (let c = 0; c <= 2; c++) {
    const start = addDaysKey(last.start, stats.cycleLength * c)
    const nextStart = addDaysKey(start, stats.cycleLength)
    // fertile window and ovulation of this cycle, only from today on
    const ov = addDaysKey(nextStart, -14)
    for (let i = -5; i <= 0; i++) {
      const k = addDaysKey(ov, i)
      if (inRange(k) && k >= today && !marks[k]) marks[k] = i === 0 ? 'ovulation' : 'fertile'
    }
    // predicted next period
    for (let i = 0; i < stats.periodLength; i++) {
      const k = addDaysKey(nextStart, i)
      if (inRange(k) && k >= today && !marks[k]) marks[k] = 'predicted-period'
    }
  }
  return marks
}
