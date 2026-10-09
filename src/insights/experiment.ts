// ─── 14-day experiments: before vs during ───────────────────────────────────
// Pure: ExperimentService loads the days and saves the result.
//
// The outcome during the experiment is compared with the 14 days before it,
// using the same permutation test (shuffled within weekdays and weekends)
// and the same minimum effects as insights. A before/after comparison can't
// rule out everything else that changed in those weeks, and the wording says so.

import { addDays } from '../utils/day'
import { effectSize, type FeatureDay } from './analyze'
import { BETTER, EXPERIMENT_SETTINGS, PAIRS, type FeatureKey, type PairConfig } from './config'
import { hashString, mean, seededRandom, stratifiedPermutationTest } from './stats'
import { experimentResultText } from './wording'

export type Verdict = 'improved' | 'worse' | 'no-clear-change' | 'not-enough-data'

export interface PeriodSummary {
  /** Mean in stored units; null with no days */
  mean: number | null
  days: number
}

export interface ExperimentResult {
  verdict: Verdict
  outcome: FeatureKey
  driver: FeatureKey
  before: PeriodSummary
  during: PeriodSummary
  driverBefore: PeriodSummary
  driverDuring: PeriodSummary
  /** during − before, in the outcome's stored units */
  difference: number | null
  p: number | null
  /** Days the user said they did it, and days they answered */
  daysDone: number
  daysAnswered: number
  text: string
}

export interface ExperimentInput {
  insightKey: string
  /** Day 1 of the baseline (14 days before the experiment) and of the experiment */
  baselineStartKey: string
  startKey: string
  /** Feature days covering both periods, plus one day after for same-night outcomes */
  days: FeatureDay[]
  checkins: { date: string; did: boolean }[]
}

export function pairForKey(key: string): PairConfig | undefined {
  return PAIRS.find((p) => `${p.driver}->${p.outcome}:${p.lag}` === key)
}

/** The first local day the result can be worked out: after the last outcome day has ended */
export function readyDay(startKey: string, offset: number): string {
  return addDays(startKey, EXPERIMENT_SETTINGS.days + offset)
}

function valueOf(day: FeatureDay | undefined, key: FeatureKey): number | null {
  if (!day) return null
  if (key === 'workMinutes') {
    const f = day.values.focusMinutes ?? null
    const s = day.values.studyMinutes ?? null
    return f === null && s === null ? null : (f ?? 0) + (s ?? 0)
  }
  return day.values[key] ?? null
}

const isWeekend = (key: string) => {
  const d = new Date(`${key}T00:00:00Z`).getUTCDay()
  return d === 0 || d === 6
}

function summarize(values: number[]): PeriodSummary {
  return { mean: values.length > 0 ? mean(values) : null, days: values.length }
}

export function evaluateExperiment(input: ExperimentInput): ExperimentResult {
  const pair = pairForKey(input.insightKey)
  if (!pair) throw new Error(`No pair configured for ${input.insightKey}`)
  const byDate = new Map(input.days.map((d) => [d.date, d]))
  const n = EXPERIMENT_SETTINGS.days

  // Outcome values for each period, after the pair's lag; driver values on the days themselves
  const y: number[] = []
  const period: number[] = [] // 0 = before, 1 = during
  const strata: string[] = []
  const driverValues: [number[], number[]] = [[], []]
  ;[input.baselineStartKey, input.startKey].forEach((start, p) => {
    for (let i = 0; i < n; i++) {
      const day = addDays(start, i)
      const dv = valueOf(byDate.get(day), pair.driver)
      if (dv !== null) driverValues[p].push(dv)
      const outDay = addDays(day, pair.offset)
      const ov = valueOf(byDate.get(outDay), pair.outcome)
      if (ov === null) continue
      y.push(ov)
      period.push(p)
      strata.push(isWeekend(outDay) ? 'we' : 'wd')
    }
  })

  const beforeVals = y.filter((_, i) => period[i] === 0)
  const duringVals = y.filter((_, i) => period[i] === 1)
  const daysDone = input.checkins.filter((c) => c.did).length

  const base = {
    outcome: pair.outcome,
    driver: pair.driver,
    before: summarize(beforeVals),
    during: summarize(duringVals),
    driverBefore: summarize(driverValues[0]),
    driverDuring: summarize(driverValues[1]),
    daysDone,
    daysAnswered: input.checkins.length,
  }

  const finish = (r: Omit<ExperimentResult, 'text'>): ExperimentResult => ({ ...r, text: experimentResultText(r) })

  if (beforeVals.length < EXPERIMENT_SETTINGS.minDaysPerPeriod || duringVals.length < EXPERIMENT_SETTINGS.minDaysPerPeriod) {
    return finish({ ...base, verdict: 'not-enough-data', difference: null, p: null })
  }

  const test = stratifiedPermutationTest(
    period,
    y,
    strata,
    (v) => v === 0,
    EXPERIMENT_SETTINGS.permutations,
    seededRandom(hashString(`${input.insightKey}@${input.startKey}`)),
  )
  const difference = test.diff // during − before
  const clear =
    test.p < EXPERIMENT_SETTINGS.maxP &&
    Math.sign(test.adjustedDiff) === Math.sign(difference) &&
    effectSize(pair.outcome, { adjusted: test.adjustedDiff, meanLow: base.before.mean!, meanHigh: base.during.mean! }) >= 1

  let verdict: Verdict = 'no-clear-change'
  if (clear) {
    const better = BETTER[pair.outcome]
    const wentUp = difference > 0
    verdict = (better === 'higher') === wentUp ? 'improved' : 'worse'
  }
  return finish({ ...base, verdict, difference, p: test.p })
}
