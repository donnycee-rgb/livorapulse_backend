// ─── Per-user analysis: feature days in, tested patterns out ────────────────
// Pure: no database access. InsightService loads the days and stores results.

import { addDays } from '../utils/day'
import {
  CYCLE_OUTCOMES,
  CYCLE_PHASES,
  INSIGHT_SETTINGS,
  MIN_EFFECT,
  PAIRS,
  type CyclePhase,
  type FeatureKey,
  type InsightSettings,
  type Lag,
  type PairConfig,
} from './config'
import { benjaminiHochberg, hashString, mean, sd, seededRandom, stratifiedPermutationTest } from './stats'

/** One local day of features. Missing values are null — never 0. */
export interface FeatureDay {
  date: string // YYYY-MM-DD
  values: Partial<Record<Exclude<FeatureKey, 'workMinutes'>, number | null>>
  cyclePhase: string | null
  cycleDay: number | null
}

/** How the driver was split: low = below the value, or at-or-below it */
export interface Split {
  value: number
  mode: 'below' | 'atOrBelow'
  source: 'threshold' | 'median'
}

export interface TestResult {
  key: string
  kind: 'pair' | 'cycle'
  driver: FeatureKey | 'cyclePhase'
  outcome: FeatureKey
  lag: Lag
  /** For cycle results: the phase compared with the rest of the cycle */
  phase?: CyclePhase
  /** Days where both values exist (after the lag) inside the window */
  pairedDays: number
  /** False when there isn't enough data; the fields below are then unset */
  testable: boolean
  split?: Split
  nLow?: number
  nHigh?: number
  /** For cycle results, "low" is the phase and "high" is the rest of the cycle */
  meanLow?: number
  meanHigh?: number
  /** meanHigh − meanLow */
  effect?: number
  /** The effect beyond what the weekday/weekend mix explains */
  adjusted?: number
  /** |adjusted| in outcome standard deviations, for ranking */
  strength?: number
  /** Spearman correlation; null for cycle phase */
  rho?: number | null
  /** Rank correlation beyond what the weekday/weekend mix explains */
  rhoAdjusted?: number
  p?: number
  q?: number
}

export function pairKey(p: Pick<PairConfig, 'driver' | 'outcome' | 'lag'>): string {
  return `${p.driver}->${p.outcome}:${p.lag}`
}

export function cycleKey(phase: CyclePhase, outcome: FeatureKey): string {
  return `cyclePhase:${phase}->${outcome}:same-day`
}

function isWeekend(key: string): boolean {
  const day = new Date(`${key}T00:00:00Z`).getUTCDay()
  return day === 0 || day === 6
}

function valueOf(day: FeatureDay | undefined, key: FeatureKey): number | null {
  if (!day) return null
  if (key === 'workMinutes') {
    // Focus and study time together; null only when neither was logged
    const f = day.values.focusMinutes ?? null
    const s = day.values.studyMinutes ?? null
    return f === null && s === null ? null : (f ?? 0) + (s ?? 0)
  }
  return day.values[key] ?? null
}

/**
 * Picks the split for the driver values. Tries the configured threshold
 * (only if it leaves a fair share of days on each side, so the averages
 * shown aren't based on a handful of days), then the median (below it,
 * then at-or-below it for heavily tied values). Returns null if no split
 * gives both groups enough days.
 */
export function chooseSplit(
  values: number[],
  threshold: number | undefined,
  minGroup: number,
  minThresholdShare: number,
): Split | null {
  const candidates: { split: Split; min: number }[] = []
  if (threshold !== undefined) {
    candidates.push({
      split: { value: threshold, mode: 'below', source: 'threshold' },
      min: Math.max(minGroup, Math.ceil(values.length * minThresholdShare)),
    })
  }
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const med = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  candidates.push({ split: { value: med, mode: 'below', source: 'median' }, min: minGroup })
  candidates.push({ split: { value: med, mode: 'atOrBelow', source: 'median' }, min: minGroup })

  for (const { split, min } of candidates) {
    const nLow = values.filter((v) => isLow(v, split)).length
    if (nLow >= min && values.length - nLow >= min) return split
  }
  return null
}

export function isLow(v: number, split: Split): boolean {
  return split.mode === 'below' ? v < split.value : v <= split.value
}

/** The weekday-adjusted effect as a multiple of the outcome's minimum effect (≥ 1 clears it) */
export function effectSize(outcome: FeatureKey, r: Pick<TestResult, 'adjusted' | 'meanLow' | 'meanHigh'>): number {
  const min = MIN_EFFECT[outcome]
  const adj = Math.abs(r.adjusted ?? 0)
  if (!min) return 0
  if (min.kind === 'absolute') return adj / min.value
  const base = Math.min(r.meanLow ?? 0, r.meanHigh ?? 0)
  if (base <= 0) return 0
  return adj / base / min.value
}

/** Days in the analysis window: the `windowDays` days before `today` */
function windowKeys(today: string, windowDays: number): string[] {
  const keys: string[] = []
  for (let i = windowDays; i >= 1; i--) keys.push(addDays(today, -i))
  return keys
}

function testPair(
  pair: PairConfig,
  byDate: Map<string, FeatureDay>,
  keys: string[],
  yesterday: string,
  settings: InsightSettings,
): TestResult {
  const key = pairKey(pair)
  const base: TestResult = { key, kind: 'pair', driver: pair.driver, outcome: pair.outcome, lag: pair.lag, pairedDays: 0, testable: false }

  const x: number[] = []
  const y: number[] = []
  const strata: string[] = []
  for (const d of keys) {
    const outDay = addDays(d, pair.offset)
    if (outDay > yesterday) continue
    const dv = valueOf(byDate.get(d), pair.driver)
    const ov = valueOf(byDate.get(outDay), pair.outcome)
    if (dv === null || ov === null) continue
    x.push(dv)
    y.push(ov)
    strata.push(`${isWeekend(d) ? 'we' : 'wd'}-${isWeekend(outDay) ? 'we' : 'wd'}`)
  }
  base.pairedDays = x.length
  if (x.length < settings.minPairedDays) return base

  const split = chooseSplit(x, pair.threshold, settings.minGroupDays, settings.minThresholdShare)
  if (!split) return base

  const lowFlags = x.map((v) => isLow(v, split))
  const low = y.filter((_, i) => lowFlags[i])
  const high = y.filter((_, i) => !lowFlags[i])
  const test = stratifiedPermutationTest(x, y, strata, (v) => isLow(v, split), settings.permutations, seededRandom(hashString(key)))
  const spread = sd(y)

  return {
    ...base,
    testable: true,
    split,
    nLow: low.length,
    nHigh: high.length,
    meanLow: mean(low),
    meanHigh: mean(high),
    effect: test.diff,
    adjusted: test.adjustedDiff,
    strength: spread > 0 ? Math.abs(test.adjustedDiff) / spread : 0,
    rho: test.rho,
    rhoAdjusted: test.rho - test.rhoNullMean,
    p: test.p,
  }
}

function testCyclePhase(
  phase: CyclePhase,
  outcome: FeatureKey,
  byDate: Map<string, FeatureDay>,
  keys: string[],
  settings: InsightSettings,
): TestResult {
  const key = cycleKey(phase, outcome)
  const base: TestResult = { key, kind: 'cycle', driver: 'cyclePhase', outcome, lag: 'same-day', phase, pairedDays: 0, testable: false }

  const inPhase: boolean[] = []
  const y: number[] = []
  const strata: string[] = []
  const cyclesInPhase = new Set<string>()
  for (const d of keys) {
    const day = byDate.get(d)
    const ov = valueOf(day, outcome)
    if (!day?.cyclePhase || day.cycleDay === null || ov === null) continue
    const match = day.cyclePhase === phase
    inPhase.push(match)
    y.push(ov)
    strata.push(isWeekend(d) ? 'we' : 'wd')
    // The period start identifies which cycle a day belongs to
    if (match) cyclesInPhase.add(addDays(d, -(day.cycleDay - 1)))
  }
  base.pairedDays = y.length
  if (y.length < settings.minPairedDays) return base

  const nLow = inPhase.filter(Boolean).length
  const nHigh = y.length - nLow
  if (nLow < settings.minGroupDays || nHigh < settings.minGroupDays) return base
  if (cyclesInPhase.size < settings.minCyclesPerPhase) return base

  // Driver: 0 = in the phase ("low"), 1 = rest of the cycle ("high"), so effect = rest − phase
  const driver = inPhase.map((m) => (m ? 0 : 1))
  const test = stratifiedPermutationTest(driver, y, strata, (v) => v === 0, settings.permutations, seededRandom(hashString(key)))
  const spread = sd(y)

  return {
    ...base,
    testable: true,
    nLow,
    nHigh,
    meanLow: mean(y.filter((_, i) => inPhase[i])),
    meanHigh: mean(y.filter((_, i) => !inPhase[i])),
    effect: test.diff,
    adjusted: test.adjustedDiff,
    strength: spread > 0 ? Math.abs(test.adjustedDiff) / spread : 0,
    rho: null,
    rhoAdjusted: test.rho - test.rhoNullMean,
    p: test.p,
  }
}

export interface AnalyzeOptions {
  /** Local day key for "today"; the window ends yesterday */
  today: string
  /** Number of periods the user has logged */
  loggedCycles: number
  pairs?: PairConfig[]
  settings?: InsightSettings
}

/**
 * Runs every configured test for one user and adds Benjamini–Hochberg
 * q-values across all the tests that had enough data.
 */
export function analyzeUser(days: FeatureDay[], opts: AnalyzeOptions): TestResult[] {
  const settings = opts.settings ?? INSIGHT_SETTINGS
  const pairs = opts.pairs ?? PAIRS
  const byDate = new Map(days.map((d) => [d.date, d]))
  const keys = windowKeys(opts.today, settings.windowDays)
  const yesterday = addDays(opts.today, -1)

  const results = pairs.map((p) => testPair(p, byDate, keys, yesterday, settings))
  if (opts.loggedCycles >= settings.minLoggedCycles) {
    for (const outcome of CYCLE_OUTCOMES) {
      for (const phase of CYCLE_PHASES) results.push(testCyclePhase(phase, outcome, byDate, keys, settings))
    }
  }

  const tested = results.filter((r) => r.testable)
  const q = benjaminiHochberg(tested.map((r) => r.p!))
  tested.forEach((r, i) => { r.q = q[i] })
  return results
}

// ─── Deciding what to show ───────────────────────────────────────────────────

/** The checks every shown insight passes, apart from q */
function consistent(r: TestResult): boolean {
  if (!r.testable || r.adjusted === undefined || r.effect === undefined) return false
  // The raw difference, the weekday-adjusted one and the adjusted rank
  // correlation (which the p-value tests) must all point the same way
  if (r.effect === 0 || Math.sign(r.adjusted) !== Math.sign(r.effect)) return false
  if ((r.rhoAdjusted ?? 0) * r.effect <= 0) return false
  return true
}

/** Strong enough to show for the first time (or again after going stale) */
export function passesNew(r: TestResult, settings: InsightSettings = INSIGHT_SETTINGS): boolean {
  return consistent(r) && r.q! < settings.qNew && effectSize(r.outcome, r) >= 1
}

/** Still strong enough to keep showing an insight that is already active */
export function passesKeep(r: TestResult, settings: InsightSettings = INSIGHT_SETTINGS): boolean {
  return consistent(r) && r.q! < settings.qKeep && effectSize(r.outcome, r) >= settings.keepEffectRatio
}

/** Strong enough to bring back an insight the user said was "not true for me" */
export function passesReturn(r: TestResult, dismissedEffect: number, settings: InsightSettings = INSIGHT_SETTINGS): boolean {
  return (
    passesNew(r, settings) &&
    r.q! < settings.qReturn &&
    Math.abs(r.effect!) >= Math.abs(dismissedEffect) * settings.returnEffectRatio
  )
}
