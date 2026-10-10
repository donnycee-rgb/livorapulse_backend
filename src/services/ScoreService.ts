import { prisma } from '../db/prisma'
import { addDays, dayBounds, dayKey, startOfDay } from '../utils/day'
import { applyStreak, resolveGoals, type Goals } from './GoalService'
import { computeStreak, getStreakMultiplier } from './StreakService'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScoreComponents {
  physical: number
  digital: number
  productivity: number
  mood: number
  eco: number
  nutrition: number
}

export type Dimension = keyof ScoreComponents

export type RollingComponents = Record<Dimension, number | null>

export interface DailyScoreResult {
  date: string
  /**
   * The LifePulse Score: the last 7 days, recent days counting most (see
   * rollingComponents). It doesn't reset at midnight. Null until anything
   * has been logged in the last 7 days.
   */
  score: number | null
  /** Each area's 7-day value behind the score; null = not tracked this week (left out) */
  rolling: RollingComponents
  /** Today only, the old way (unlogged areas count 0). Kept for comparison */
  todayScore: number
  insight: string
  /** Today's area scores, for the "today's goals" cards; unlogged areas are 0 */
  components: ScoreComponents
  /** Which dimensions have at least one log today */
  logged: Record<Dimension, boolean>
  /** Today's goals after the streak multiplier — what each component is measured against */
  goals: Goals
  streak: number
  multiplier: number
}

// The single source of truth for the LifePulse Score. The app displays this
// value; it no longer calculates its own.
export const SCORE_WEIGHTS: Record<Dimension, number> = {
  physical: 0.23,
  digital: 0.18,
  productivity: 0.2,
  mood: 0.14,
  eco: 0.14,
  nutrition: 0.11,
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function weightedScore(c: ScoreComponents): number {
  const total = (Object.keys(SCORE_WEIGHTS) as Dimension[])
    .reduce((sum, k) => sum + (c[k] ?? 0) * SCORE_WEIGHTS[k], 0)
  return Math.round(clamp(total, 0, 100))
}

// ─── Rolling 7-day score ─────────────────────────────────────────────────────
// Wellbeing doesn't reset at midnight, so neither does the score. Each area
// uses its scores from the last 7 days, today counting most and each earlier
// day a little less. An area with no logs in that week is left out instead of
// counting as 0, so not tracking something (e.g. eco) never costs points.

export const ROLLING_DAYS = 7
/** Weight of a day `n` days ago: today 1, yesterday 0.8, … 6 days ago 0.26 */
export const DAY_DECAY = 0.8

export interface ComponentDay {
  /** 0 = the day being scored, 1 = the day before, … */
  ageDays: number
  /** null (or missing) = that area wasn't logged that day */
  components: Partial<Record<Dimension, number | null>>
}

const DIMENSIONS = Object.keys(SCORE_WEIGHTS) as Dimension[]

export function rollingComponents(days: ComponentDay[]): RollingComponents {
  const out = {} as RollingComponents
  for (const d of DIMENSIONS) {
    let sum = 0
    let weights = 0
    for (const day of days) {
      const v = day.components[d]
      if (v === null || v === undefined || day.ageDays < 0 || day.ageDays >= ROLLING_DAYS) continue
      const w = DAY_DECAY ** day.ageDays
      sum += v * w
      weights += w
    }
    out[d] = weights > 0 ? Math.round(sum / weights) : null
  }
  return out
}

/** The weighted score over the tracked areas only; null if nothing was tracked this week */
export function rollingScore(r: RollingComponents): number | null {
  let total = 0
  let weights = 0
  for (const d of DIMENSIONS) {
    const v = r[d]
    if (v === null) continue
    total += v * SCORE_WEIGHTS[d]
    weights += SCORE_WEIGHTS[d]
  }
  return weights > 0 ? Math.round(clamp(total / weights, 0, 100)) : null
}

// ─── Component scores (0–100) ────────────────────────────────────────────────

/** 70% steps, 30% sleep. Sleep is full marks within 1.5 h above the goal; oversleeping beyond that slowly costs points. */
export function physicalScore(steps: number, sleepMinutes: number, goalSteps: number, goalSleepHours: number): number {
  const stepsScore = clamp((steps / goalSteps) * 100, 0, 100)

  const sleepHours = sleepMinutes / 60
  let sleepScore: number
  if (sleepHours <= goalSleepHours) sleepScore = (sleepHours / goalSleepHours) * 100
  else if (sleepHours <= goalSleepHours + 1.5) sleepScore = 100
  else sleepScore = clamp(100 - (sleepHours - goalSleepHours - 1.5) * 20, 50, 100)

  return stepsScore * 0.7 + sleepScore * 0.3
}

/**
 * Starts at 100 and loses points for going over personal limits:
 * social (up to −40), entertainment (up to −40), and total
 * non-productive screen time over the screen goal (up to −20).
 * Productive screen time is never penalised.
 */
export function digitalScore(
  totalMinutes: number,
  socialMinutes: number,
  entertainmentMinutes: number,
  productiveMinutes: number,
  goals: Pick<Goals, 'goalSocialMinutes' | 'goalEntertainmentMinutes' | 'goalScreenMinutes'>,
): number {
  const over = (value: number, limit: number, maxPenalty: number) =>
    value > limit ? clamp(((value - limit) / limit) * maxPenalty, 0, maxPenalty) : 0

  const leisureMinutes = Math.max(0, totalMinutes - productiveMinutes)
  return clamp(
    100
      - over(socialMinutes, goals.goalSocialMinutes, 40)
      - over(entertainmentMinutes, goals.goalEntertainmentMinutes, 40)
      - over(leisureMinutes, goals.goalScreenMinutes, 20),
    0,
    100,
  )
}

/** Focus minutes vs goal. Productive screen time counts at 30% of a focus minute. Reaches 100 at the goal. */
export function productivityScore(focusMinutes: number, productiveScreenMinutes: number, goalFocusMinutes: number): number {
  const effective = focusMinutes + productiveScreenMinutes * 0.3
  return clamp((effective / goalFocusMinutes) * 100, 0, 100)
}

const EMOJI_SCORE: Record<string, number> = { '😄': 100, '🙂': 75, '😐': 50, '😕': 25, '😣': 0 }

/**
 * 60% how you feel (emoji), 40% stress (1 = calm → 100, 10 = very stressed → 0). Averaged over the day's logs.
 * A log can hold just one of the two; if only one was given all day, it makes up the whole score.
 */
export function moodScore(logs: { emoji: string | null; stressScore: number | null }[]): number {
  const feels = logs.flatMap((l) => (l.emoji !== null ? [EMOJI_SCORE[l.emoji] ?? 50] : []))
  const stresses = logs.flatMap((l) => (l.stressScore !== null ? [l.stressScore] : []))
  if (feels.length === 0 && stresses.length === 0) return 0

  const feel = feels.length > 0 ? feels.reduce((s, v) => s + v, 0) / feels.length : null
  const calm = stresses.length > 0
    ? clamp(((10 - stresses.reduce((s, v) => s + v, 0) / stresses.length) / 9) * 100, 0, 100)
    : null
  if (feel === null) return calm!
  if (calm === null) return feel
  return feel * 0.6 + calm * 0.4
}

export function ecoScore(actionCount: number, goalEcoActions: number): number {
  return clamp((actionCount / goalEcoActions) * 100, 0, 100)
}

/**
 * Builds up as you log toward your calorie goal, is full marks within ±10% of
 * it, then drops for eating well over it (0 at 60% over). Eating more is no
 * longer always "better".
 */
export function nutritionScore(totalCalories: number, goalCalories: number): number {
  const ratio = totalCalories / goalCalories
  if (ratio <= 0) return 0
  if (ratio < 0.9) return (ratio / 0.9) * 100
  if (ratio <= 1.1) return 100
  return clamp(100 - ((ratio - 1.1) / 0.5) * 100, 0, 100)
}

// ─── Insight ─────────────────────────────────────────────────────────────────

function buildInsight(c: ScoreComponents, logged: Record<Dimension, boolean>, goals: Goals, streak: number, hasScore: boolean): string {
  const loggedCount = Object.values(logged).filter(Boolean).length
  if (loggedCount === 0) {
    // The score covers the last 7 days, so early in the day it's already there
    return hasScore
      ? "Nothing logged yet today. Your score is based on your last 7 days — log a walk, a meal or your mood to keep it up to date."
      : 'Nothing logged yet — log a walk, a meal or your mood to start your LifePulse Score.'
  }

  if (streak >= 7) {
    const [best] = (Object.entries(c) as [Dimension, number][]).reduce((a, b) => (a[1] >= b[1] ? a : b))
    if (c[best] >= 80) return `${streak}-day streak! Your ${best} score is strong — keep it going.`
  }

  // Nudge the unlogged dimension with the most weight first, then the weakest logged one
  const unlogged = (Object.keys(SCORE_WEIGHTS) as Dimension[])
    .filter((d) => !logged[d])
    .sort((a, b) => SCORE_WEIGHTS[b] - SCORE_WEIGHTS[a])
  const target: Dimension = unlogged[0]
    ?? (Object.entries(c) as [Dimension, number][]).reduce((a, b) => (a[1] <= b[1] ? a : b))[0]

  const notLogged = !logged[target]
  const messages: Record<Dimension, string> = {
    physical: notLogged
      ? `Log a walk or your sleep — your step goal today is ${goals.goalStepsPerDay.toLocaleString()}.`
      : `Try to reach ${goals.goalStepsPerDay.toLocaleString()} steps today to lift your physical score.`,
    digital: notLogged
      ? 'Log your screen time to see how your digital habits affect your score.'
      : 'Your social or entertainment screen time is over your limits — try a screen break.',
    productivity: notLogged
      ? `Start a focus session — your goal today is ${goals.goalFocusMinutes} minutes.`
      : `One more focus session will get you closer to your ${goals.goalFocusMinutes}-minute goal.`,
    mood: notLogged
      ? 'Take a few seconds to log how you feel today.'
      : 'Your stress looks high — try a short breathing exercise or a walk outside.',
    eco: notLogged
      ? 'Log an eco action today — walking, recycling or a low-carbon meal all count.'
      : `Aim for ${goals.goalEcoActionsPerDay} eco actions today to max out your eco score.`,
    nutrition: notLogged
      ? 'Log your meals on the Nutrition page to add your nutrition score.'
      : `You're working toward ${goals.goalCaloriesPerDay.toLocaleString()} kcal today — keep logging your meals.`,
  }
  return messages[target]
}

// ─── Main export ──────────────────────────────────────────────────────────────

/** Calculate (and save) the score for a local calendar day — a YYYY-MM-DD key or an instant within that day */
export async function computeDailyScore(userId: string, date: Date | string = new Date()): Promise<DailyScoreResult> {
  const { key, start, end } = dayBounds(date)
  const range = { gte: start, lt: end }

  const [physical, digital, productivity, mood, eco, nutrition, profile, streak] = await Promise.all([
    prisma.physicalActivityEntry.findMany({ where: { userId, timestamp: range }, select: { steps: true, sleepMinutes: true } }),
    prisma.digitalUsageEntry.findMany({ where: { userId, date: range }, select: { screenTimeMinutes: true, categoryBreakdown: true } }),
    prisma.productivitySession.findMany({ where: { userId, startedAt: range }, select: { durationSec: true } }),
    prisma.moodLog.findMany({ where: { userId, timestamp: range }, select: { emoji: true, stressScore: true } }),
    // Only actions that actually save CO₂ count — choosing "Driving" logs the
    // transport mode with 0 kg saved and shouldn't raise the eco score
    prisma.ecoAction.count({ where: { userId, timestamp: range, impactKgCO2: { gt: 0 } } }),
    prisma.nutritionLog.findMany({ where: { userId, timestamp: range }, select: { calories: true } }),
    prisma.userProfile.findUnique({
      where: { userId },
      select: {
        goalStepsPerDay: true, goalSleepHours: true, goalScreenMinutes: true, goalFocusMinutes: true,
        goalEcoActionsPerDay: true, goalSocialMinutes: true, goalEntertainmentMinutes: true, goalCaloriesPerDay: true,
      },
    }),
    computeStreak(userId, key),
  ])
  const pastSummaries = await prisma.dailySummary.findMany({
    where: { userId, date: { gte: startOfDay(addDays(key, -(ROLLING_DAYS - 1))), lt: start } },
    orderBy: { updatedAt: 'asc' },
    select: {
      date: true, physicalScore: true, digitalScore: true, productivityScore: true,
      moodScore: true, ecoScore: true, nutritionScore: true,
    },
  })

  const multiplier = getStreakMultiplier(streak)
  const goals = applyStreak(resolveGoals(profile), multiplier)

  // ── Raw totals ───────────────────────────────────────────────────────────
  const totalSteps = physical.reduce((s, e) => s + e.steps, 0)
  const totalSleepMin = physical.reduce((s, e) => s + e.sleepMinutes, 0)
  const focusMin = productivity.reduce((s, e) => s + e.durationSec, 0) / 60
  const totalCalories = nutrition.reduce((s, e) => s + e.calories, 0)

  let screenMin = 0
  let socialMin = 0
  let entertainMin = 0
  let productiveMin = 0
  for (const e of digital) {
    const bd = (e.categoryBreakdown ?? {}) as Record<string, number>
    screenMin += e.screenTimeMinutes
    socialMin += bd['Social'] ?? 0
    entertainMin += bd['Entertainment'] ?? 0
    productiveMin += bd['Productive'] ?? 0
  }

  const logged: Record<Dimension, boolean> = {
    physical: physical.length > 0,
    digital: digital.length > 0,
    productivity: productivity.length > 0 || productiveMin > 0,
    mood: mood.length > 0,
    eco: eco > 0,
    nutrition: nutrition.length > 0,
  }

  // ── Components — a dimension with nothing logged scores 0 ────────────────
  const components: ScoreComponents = {
    physical: logged.physical ? Math.round(physicalScore(totalSteps, totalSleepMin, goals.goalStepsPerDay, goals.goalSleepHours)) : 0,
    digital: logged.digital ? Math.round(digitalScore(screenMin, socialMin, entertainMin, productiveMin, goals)) : 0,
    productivity: logged.productivity ? Math.round(productivityScore(focusMin, productiveMin, goals.goalFocusMinutes)) : 0,
    mood: Math.round(moodScore(mood)),
    eco: Math.round(ecoScore(eco, goals.goalEcoActionsPerDay)),
    nutrition: logged.nutrition ? Math.round(nutritionScore(totalCalories, goals.goalCaloriesPerDay)) : 0,
  }

  const todayScore = weightedScore(components)

  // ── Rolling 7-day score ──────────────────────────────────────────────────
  // Today's areas count only if logged; earlier days come from their saved
  // summaries (null = not logged that day)
  const todayLogged = Object.fromEntries(DIMENSIONS.map((d) => [d, logged[d] ? components[d] : null])) as RollingComponents
  // Older rows were keyed at UTC midnight and newer ones at local midnight —
  // both map to the same local day, and the most recently updated row wins
  const byDay = new Map<string, ComponentDay>()
  for (const s of pastSummaries) {
    const dk = dayKey(s.date)
    byDay.set(dk, {
      ageDays: Math.round((Date.parse(`${key}T00:00:00Z`) - Date.parse(`${dk}T00:00:00Z`)) / 86400000),
      components: {
        physical: s.physicalScore, digital: s.digitalScore, productivity: s.productivityScore,
        mood: s.moodScore, eco: s.ecoScore, nutrition: s.nutritionScore,
      },
    })
  }
  const rolling = rollingComponents([{ ageDays: 0, components: todayLogged }, ...byDay.values()])
  const score = rollingScore(rolling)
  const insight = buildInsight(components, logged, goals, streak, score !== null)

  // ── Persist so the history shows exactly what the user saw ───────────────
  // Area scores are saved as null when not logged, so later days can tell
  // "not logged" from "logged and scored 0"
  const summary = {
    insightText: insight,
    physicalScore: todayLogged.physical,
    digitalScore: todayLogged.digital,
    productivityScore: todayLogged.productivity,
    moodScore: todayLogged.mood,
    ecoScore: todayLogged.eco,
    nutritionScore: todayLogged.nutrition,
    score,
  }
  await prisma.dailySummary.upsert({
    where: { userId_date: { userId, date: start } },
    create: { userId, date: start, ...summary },
    update: summary,
  })

  return { date: key, score, rolling, todayScore, insight, components, logged, goals, streak, multiplier }
}
