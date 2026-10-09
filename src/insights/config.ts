// ─── Insights engine settings ───────────────────────────────────────────────
// Which driver → outcome pairs are tested, and the bar a pattern must clear
// before a user sees it. Edit pairs and thresholds here, nowhere else.

/** Numeric per-day values the engine can analyse (DailyFeatures columns, plus workMinutes) */
export type FeatureKey =
  | 'sleepMinutes'
  | 'steps'
  | 'screenMinutes'
  | 'socialMinutes'
  | 'entertainmentMinutes'
  | 'focusMinutes'
  | 'studyMinutes'
  | 'workMinutes' // focus + study, derived during analysis
  | 'moodValue'
  | 'stressScore'
  | 'caloriesIn'
  | 'waterGlasses'
  | 'ecoActions'

/**
 * How the outcome day relates to the driver day.
 *
 * Sleep attribution: DailyFeatures.sleepMinutes on day D is the night that
 * ended on the morning of D (sleep is logged in the morning, for "last night").
 * So "sleep → stress that day" is offset 0, and "steps → sleep that night"
 * is offset +1 (that night's sleep is stored on the next day).
 */
export type Lag = 'same-day' | 'next-day' | 'same-night'

export interface PairConfig {
  driver: FeatureKey
  outcome: FeatureKey
  lag: Lag
  /** Days from the driver's day to the outcome's day */
  offset: 0 | 1
  /**
   * Preferred split point in the driver's units: days below it are the "low"
   * group. If either group would have too few days, the user's own median is
   * used instead. The choice depends only on the driver values, never on the
   * outcome, so it doesn't inflate false positives.
   */
  threshold?: number
}

export const PAIRS: PairConfig[] = [
  { driver: 'sleepMinutes', outcome: 'stressScore', lag: 'same-day', offset: 0, threshold: 360 },
  { driver: 'sleepMinutes', outcome: 'moodValue', lag: 'same-day', offset: 0, threshold: 360 },
  { driver: 'sleepMinutes', outcome: 'focusMinutes', lag: 'same-day', offset: 0, threshold: 360 },
  { driver: 'steps', outcome: 'moodValue', lag: 'same-day', offset: 0 },
  { driver: 'steps', outcome: 'sleepMinutes', lag: 'same-night', offset: 1 },
  { driver: 'screenMinutes', outcome: 'sleepMinutes', lag: 'same-night', offset: 1 },
  { driver: 'socialMinutes', outcome: 'focusMinutes', lag: 'same-day', offset: 0, threshold: 120 },
  { driver: 'socialMinutes', outcome: 'moodValue', lag: 'same-day', offset: 0, threshold: 120 },
  { driver: 'entertainmentMinutes', outcome: 'sleepMinutes', lag: 'same-night', offset: 1 },
  { driver: 'workMinutes', outcome: 'stressScore', lag: 'same-day', offset: 0 },
  { driver: 'workMinutes', outcome: 'stressScore', lag: 'next-day', offset: 1 },
  { driver: 'waterGlasses', outcome: 'moodValue', lag: 'same-day', offset: 0, threshold: 6 },
  { driver: 'caloriesIn', outcome: 'moodValue', lag: 'same-day', offset: 0 },
  { driver: 'ecoActions', outcome: 'moodValue', lag: 'same-day', offset: 0 },
]

/** Outcomes compared across cycle phases (same day), for users with enough logged cycles */
export const CYCLE_OUTCOMES: FeatureKey[] = ['moodValue', 'stressScore', 'sleepMinutes', 'steps']
export const CYCLE_PHASES = ['menstrual', 'follicular', 'ovulation', 'luteal'] as const
export type CyclePhase = (typeof CYCLE_PHASES)[number]

/** The smallest difference worth telling someone about, per outcome */
export type MinEffect = { kind: 'absolute'; value: number } | { kind: 'relative'; value: number }

export const MIN_EFFECT: Partial<Record<FeatureKey, MinEffect>> = {
  stressScore: { kind: 'absolute', value: 1 }, // stored 1–10 = half a step on the 1–5 slider
  moodValue: { kind: 'absolute', value: 0.4 }, // 1–5
  sleepMinutes: { kind: 'absolute', value: 30 },
  focusMinutes: { kind: 'relative', value: 0.2 }, // 20% of the lower group's mean
  steps: { kind: 'absolute', value: 1000 },
}

export const INSIGHT_SETTINGS = {
  /** Only the most recent days are analysed */
  windowDays: 90,
  /** Days where both the driver and the outcome were logged */
  minPairedDays: 14,
  /** Days in each comparison group */
  minGroupDays: 5,
  /** A pair's fixed threshold is used only if each side has this share of the days; otherwise the median */
  minThresholdShare: 0.2,
  permutations: 2000,

  /** A new insight needs q below this (Benjamini–Hochberg across the user's tests).
   *  0.05 keeps users with no real patterns at ~2.5% seeing any insight (see test/insights/analyze.test.ts) */
  qNew: 0.05,
  /** An active insight stays active until q rises above this, so it doesn't flicker nightly */
  qKeep: 0.2,
  /** ...and while its effect stays above this share of the minimum effect */
  keepEffectRatio: 0.75,

  /** A dismissed insight comes back only if it is much stronger than when dismissed */
  qReturn: 0.01,
  returnEffectRatio: 1.5,

  /** Cycle-phase comparisons need this many logged periods */
  minLoggedCycles: 2,
  /** ...and each phase's days must come from at least this many different cycles */
  minCyclesPerPhase: 2,
}

export type InsightSettings = typeof INSIGHT_SETTINGS
