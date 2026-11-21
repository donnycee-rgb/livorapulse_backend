// ─── "Your days so far" ─────────────────────────────────────────────────────
// Before any pattern has been tested, show the person what their own logs
// already say, as plain numbers: averages, and the same measure on two kinds
// of day side by side, with how many days are behind each. Nothing is
// estimated or filled in, and nothing is called a pattern: these are just
// their own days, counted. Pure: no database.

import type { FeatureDay } from './analyze'

export type EarlyAverage = { value: number; days: number }
export type EarlyGroup = { label: string; value: number; days: number }
export type EarlyComparison = {
  key: string
  /** What's being compared, e.g. "Mood" */
  title: string
  /** 'score' values are 1–5 */
  unit: 'score'
  a: EarlyGroup
  b: EarlyGroup
}
export type EarlyLook = {
  daysLogged: number
  averages: { sleepMinutes: EarlyAverage | null; mood: EarlyAverage | null; stress: EarlyAverage | null; steps: EarlyAverage | null }
  comparisons: EarlyComparison[]
}

/** Each side of a comparison needs at least this many days before it's shown */
export const EARLY_MIN_DAYS = 2
const SLEEP_SPLIT = 7 * 60
const STEPS_SPLIT = 6000

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
const round1 = (x: number) => Math.round(x * 10) / 10

function average(days: FeatureDay[], pick: (d: FeatureDay) => number | null | undefined): EarlyAverage | null {
  const v = days.map(pick).filter((x): x is number => x != null && Number.isFinite(x))
  return v.length ? { value: round1(mean(v)), days: v.length } : null
}

function compare(
  days: FeatureDay[], key: string, title: string,
  driver: (d: FeatureDay) => number | null | undefined, outcome: (d: FeatureDay) => number | null | undefined,
  split: number, highLabel: string, lowLabel: string,
): EarlyComparison | null {
  const both = days
    .map((d) => ({ x: driver(d), y: outcome(d) }))
    .filter((p): p is { x: number; y: number } => p.x != null && p.y != null)
  const high = both.filter((p) => p.x >= split).map((p) => p.y)
  const low = both.filter((p) => p.x < split).map((p) => p.y)
  if (high.length < EARLY_MIN_DAYS || low.length < EARLY_MIN_DAYS) return null
  return {
    key, title, unit: 'score',
    a: { label: lowLabel, value: round1(mean(low)), days: low.length },
    b: { label: highLabel, value: round1(mean(high)), days: high.length },
  }
}

export function earlyLook(days: FeatureDay[]): EarlyLook {
  const v = (k: keyof FeatureDay['values']) => (d: FeatureDay) => d.values[k] ?? null
  const stress = (d: FeatureDay) => (d.values.stressScore == null ? null : d.values.stressScore / 2) // stored 1–10, shown 1–5
  const steps = (d: FeatureDay) => (d.values.steps ? d.values.steps : null)

  const daysLogged = days.filter((d) => Object.values(d.values).some((x) => x != null)).length
  const comparisons = [
    compare(days, 'sleep-mood', 'Mood and sleep', v('sleepMinutes'), v('moodValue'), SLEEP_SPLIT, 'After 7 h of sleep or more', 'After less than 7 h'),
    compare(days, 'sleep-stress', 'Stress and sleep', v('sleepMinutes'), stress, SLEEP_SPLIT, 'After 7 h of sleep or more', 'After less than 7 h'),
    compare(days, 'steps-mood', 'Mood and steps', steps, v('moodValue'), STEPS_SPLIT, 'Days with 6,000 steps or more', 'Days with fewer steps'),
  ].filter((c): c is EarlyComparison => c !== null)

  return {
    daysLogged,
    averages: {
      sleepMinutes: average(days, v('sleepMinutes')),
      mood: average(days, v('moodValue')),
      stress: average(days, stress),
      steps: average(days, steps),
    },
    comparisons,
  }
}
