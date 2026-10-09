// ─── "Worth getting checked" flags ──────────────────────────────────────────
// Conservative, rule-based prompts — never a diagnosis. Each rule needs a
// pattern that holds for weeks (or across several cycles), not one bad day,
// and enough logged data to be sure of it. Pure: FlagService loads the data.

import { addDays } from '../utils/day'
import type { FeatureDay } from './analyze'

export type FlagKey = 'low-mood' | 'short-sleep' | 'cycle-length' | 'missed-period' | 'heavy-flow'

export const FLAG_SETTINGS = {
  lowMood: {
    weeks: 2,
    /** Daily mood (1–5) at or below this is "low": the two lowest emojis */
    lowAt: 2,
    /** Logged days needed in each week, and the share of them that must be low */
    minDaysPerWeek: 3,
    minLowShare: 0.5, // strictly more than half — "most days"
  },
  shortSleep: {
    weeks: 3,
    shortUnderMinutes: 360, // 6 h
    minNightsPerWeek: 3,
    minShortShare: 0.5,
  },
  cycleLength: {
    typicalMin: 21,
    typicalMax: 35,
    /** Look at this many of the most recent finished cycles… */
    recentCycles: 3,
    /** …and flag when at least this many are outside the typical range */
    minOutside: 2,
    withinDays: 365,
  },
  missedPeriod: {
    /** Days since the last logged period started */
    daysSinceStart: 60,
    /** Only for people tracking: 2+ periods logged, the last within this many days */
    minPeriods: 2,
    trackingWithinDays: 120,
  },
  heavyFlow: {
    recentPeriods: 4,
    minHeavy: 3,
    withinDays: 365,
  },
  /** A dismissed flag stays hidden this long, then shows again if the pattern is still there */
  quietAfterDismissDays: 30,
}

export interface FlagPeriod {
  startKey: string
  flowIntensity: string | null
}

export interface RaisedFlag {
  key: FlagKey
  /** The numbers behind the flag; wording.ts turns them into sentences */
  evidence: Record<string, number | string | number[]>
}

function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86400000)
}

/**
 * True when every one of the last `weeks` weeks has enough logged days and
 * more than `minShare` of them match `isLow`. Requiring each week (not just
 * the total) means one rough week can't raise a flag on its own.
 */
function sustained(
  byDate: Map<string, FeatureDay>,
  today: string,
  weeks: number,
  pick: (d: FeatureDay) => number | null | undefined,
  isLow: (v: number) => boolean,
  minPerWeek: number,
  minShare: number,
): { logged: number; low: number; values: number[] } | null {
  let logged = 0
  let low = 0
  const values: number[] = []
  for (let w = 0; w < weeks; w++) {
    let wLogged = 0
    let wLow = 0
    for (let i = 1; i <= 7; i++) {
      const v = pick(byDate.get(addDays(today, -(w * 7 + i))) ?? ({ values: {} } as FeatureDay))
      if (v === null || v === undefined) continue
      wLogged++
      values.push(v)
      if (isLow(v)) wLow++
    }
    if (wLogged < minPerWeek || wLow / wLogged <= minShare) return null
    logged += wLogged
    low += wLow
  }
  return { logged, low, values }
}

export function lowMoodFlag(byDate: Map<string, FeatureDay>, today: string): RaisedFlag | null {
  const s = FLAG_SETTINGS.lowMood
  const r = sustained(byDate, today, s.weeks, (d) => d.values.moodValue, (v) => v <= s.lowAt, s.minDaysPerWeek, s.minLowShare)
  return r ? { key: 'low-mood', evidence: { lowDays: r.low, loggedDays: r.logged, weeks: s.weeks } } : null
}

export function shortSleepFlag(byDate: Map<string, FeatureDay>, today: string): RaisedFlag | null {
  const s = FLAG_SETTINGS.shortSleep
  const r = sustained(byDate, today, s.weeks, (d) => d.values.sleepMinutes, (v) => v < s.shortUnderMinutes, s.minNightsPerWeek, s.minShortShare)
  if (!r) return null
  const avg = Math.round(r.values.reduce((a, b) => a + b, 0) / r.values.length)
  return { key: 'short-sleep', evidence: { shortNights: r.low, loggedNights: r.logged, averageMinutes: avg, weeks: s.weeks } }
}

/** @param periods oldest first */
export function cycleLengthFlag(periods: FlagPeriod[], today: string): RaisedFlag | null {
  const s = FLAG_SETTINGS.cycleLength
  const lengths: number[] = []
  periods.forEach((p, i) => {
    const next = periods[i + 1]
    if (next && daysBetween(p.startKey, today) <= s.withinDays) lengths.push(daysBetween(p.startKey, next.startKey))
  })
  const recent = lengths.slice(-s.recentCycles)
  if (recent.length < s.recentCycles) return null
  const outside = recent.filter((l) => l < s.typicalMin || l > s.typicalMax)
  if (outside.length < s.minOutside) return null
  return { key: 'cycle-length', evidence: { lengths: recent, outside: outside.length, typicalMin: s.typicalMin, typicalMax: s.typicalMax } }
}

export function missedPeriodFlag(periods: FlagPeriod[], today: string): RaisedFlag | null {
  const s = FLAG_SETTINGS.missedPeriod
  if (periods.length < s.minPeriods) return null
  const last = periods[periods.length - 1]
  const since = daysBetween(last.startKey, today)
  // Someone who stopped tracking long ago hasn't "missed" anything we can tell
  if (since < s.daysSinceStart || since > s.trackingWithinDays) return null
  return { key: 'missed-period', evidence: { daysSince: since, lastStart: last.startKey } }
}

export function heavyFlowFlag(periods: FlagPeriod[], today: string): RaisedFlag | null {
  const s = FLAG_SETTINGS.heavyFlow
  const recent = periods.filter((p) => daysBetween(p.startKey, today) <= s.withinDays && p.flowIntensity).slice(-s.recentPeriods)
  const heavy = recent.filter((p) => p.flowIntensity === 'heavy').length
  if (recent.length < s.minHeavy || heavy < s.minHeavy) return null
  return { key: 'heavy-flow', evidence: { heavyPeriods: heavy, periods: recent.length } }
}

/** Every rule, in the order flags are shown (wellbeing first) */
export function evaluateFlags(input: { today: string; days: FeatureDay[]; periods: FlagPeriod[] }): RaisedFlag[] {
  const byDate = new Map(input.days.map((d) => [d.date, d]))
  return [
    lowMoodFlag(byDate, input.today),
    shortSleepFlag(byDate, input.today),
    cycleLengthFlag(input.periods, input.today),
    missedPeriodFlag(input.periods, input.today),
    heavyFlowFlag(input.periods, input.today),
  ].filter((f): f is RaisedFlag => f !== null)
}
