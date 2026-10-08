// ─── Personal goals ─────────────────────────────────────────────────────────
// One place for how goals are created from onboarding answers and how the
// streak multiplier adjusts them, so the score, the dashboard and the AI coach
// all work from the same numbers.

export interface Goals {
  goalStepsPerDay: number
  goalSleepHours: number
  goalScreenMinutes: number
  goalFocusMinutes: number
  goalEcoActionsPerDay: number
  goalSocialMinutes: number
  goalEntertainmentMinutes: number
  goalCaloriesPerDay: number
}

export const DEFAULT_GOALS: Goals = {
  goalStepsPerDay: 8000,
  goalSleepHours: 8,
  goalScreenMinutes: 240,
  goalFocusMinutes: 60,
  goalEcoActionsPerDay: 3,
  goalSocialMinutes: 60,
  goalEntertainmentMinutes: 90,
  goalCaloriesPerDay: 2000,
}

// Allowed ranges — also used to validate goals edited in Settings.
// A goal of 0 would break every "progress vs goal" calculation.
export const GOAL_LIMITS: Record<keyof Goals, [number, number]> = {
  goalStepsPerDay: [1000, 40000],
  goalSleepHours: [4, 12],
  goalScreenMinutes: [30, 960],
  goalFocusMinutes: [10, 600],
  goalEcoActionsPerDay: [1, 10],
  goalSocialMinutes: [10, 600],
  goalEntertainmentMinutes: [10, 600],
  goalCaloriesPerDay: [1000, 5000],
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))
const roundTo = (n: number, step: number) => Math.round(n / step) * step

type ProfileGoals = Partial<Record<keyof Goals, number | null>>

/** Stored goals with defaults filled in and any out-of-range values pulled back into range */
export function resolveGoals(profile: ProfileGoals | null | undefined): Goals {
  const out = { ...DEFAULT_GOALS }
  for (const key of Object.keys(DEFAULT_GOALS) as (keyof Goals)[]) {
    const v = profile?.[key]
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
      const [min, max] = GOAL_LIMITS[key]
      out[key] = clamp(v, min, max)
    }
  }
  return out
}

/**
 * Goals for today after the streak multiplier.
 * - Steps, focus and eco actions rise gradually as the streak grows.
 * - Social and entertainment screen-time limits tighten.
 * - Sleep and calories stay as set: more sleep or more food isn't "progress".
 */
export function applyStreak(goals: Goals, multiplier: number): Goals {
  if (multiplier === 1) return goals
  return {
    ...goals,
    goalStepsPerDay: Math.min(roundTo(goals.goalStepsPerDay * multiplier, 500), GOAL_LIMITS.goalStepsPerDay[1]),
    goalFocusMinutes: Math.min(roundTo(goals.goalFocusMinutes * multiplier, 5), GOAL_LIMITS.goalFocusMinutes[1]),
    goalEcoActionsPerDay: Math.min(Math.round(goals.goalEcoActionsPerDay * multiplier), GOAL_LIMITS.goalEcoActionsPerDay[1]),
    goalSocialMinutes: Math.max(roundTo(goals.goalSocialMinutes / multiplier, 5), GOAL_LIMITS.goalSocialMinutes[0]),
    goalEntertainmentMinutes: Math.max(roundTo(goals.goalEntertainmentMinutes / multiplier, 5), GOAL_LIMITS.goalEntertainmentMinutes[0]),
    goalScreenMinutes: Math.max(roundTo(goals.goalScreenMinutes / multiplier, 15), GOAL_LIMITS.goalScreenMinutes[0]),
  }
}

// ─── Onboarding ──────────────────────────────────────────────────────────────

export interface OnboardingAnswers {
  dateOfBirth: string
  gender: string
  heightCm?: number
  weightKg?: number
  hasDisability: boolean
  primaryGoal: string
  currentActivityLevel: string
  currentSleepHours: number
  currentScreenHours: number
  ecoConsciousness: string
}

const ACTIVITY_FACTOR: Record<string, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  'very-active': 1.9,
}

function ageFrom(dateOfBirth: string): number {
  return Math.floor((Date.now() - new Date(dateOfBirth).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
}

/**
 * Daily calories from the Mifflin–St Jeor equation × activity level,
 * adjusted for the user's main goal. Falls back to 2,000 kcal when
 * weight, height or age is missing.
 */
export function calculateCalorieGoal(a: Pick<OnboardingAnswers, 'dateOfBirth' | 'gender' | 'heightCm' | 'weightKg' | 'currentActivityLevel' | 'primaryGoal'>): number {
  const age = ageFrom(a.dateOfBirth)
  if (!a.weightKg || !a.heightCm || !Number.isFinite(age) || age <= 0) return DEFAULT_GOALS.goalCaloriesPerDay

  // +5 for men, −161 for women; the midpoint when gender isn't specified
  const sexConstant = a.gender === 'male' ? 5 : a.gender === 'female' ? -161 : -78
  const bmr = 10 * a.weightKg + 6.25 * a.heightCm - 5 * age + sexConstant
  let calories = bmr * (ACTIVITY_FACTOR[a.currentActivityLevel] ?? 1.375)

  // No deficit for under-18s — they are still growing
  if (a.primaryGoal === 'lose-weight' && age >= 18) calories -= 500
  if (a.primaryGoal === 'gain-muscle') calories += 300

  const floor = a.gender === 'male' ? 1500 : a.gender === 'female' ? 1200 : 1350
  return clamp(roundTo(calories, 50), floor, GOAL_LIMITS.goalCaloriesPerDay[1])
}

export function calculateGoals(a: OnboardingAnswers): Goals {
  const age = ageFrom(a.dateOfBirth)

  // Steps — from current activity, capped for age and disability
  const baseSteps: Record<string, number> = {
    sedentary: 4000, light: 6000, moderate: 8000, active: 10000, 'very-active': 12000,
  }
  let steps = baseSteps[a.currentActivityLevel] ?? 6000
  if (age > 60) steps = Math.min(steps, 6000)
  if (age < 18) steps = Math.min(steps, 8000)
  if (a.primaryGoal === 'lose-weight') steps += 1000
  if (a.primaryGoal === 'improve-fitness') steps += 2000
  if (a.hasDisability) steps = Math.min(steps, 3000)

  // Sleep — nudge toward a healthy range for the user's age
  let sleep: number
  if (a.currentSleepHours < 6) sleep = 7
  else if (a.currentSleepHours < 7) sleep = 7.5
  else if (a.currentSleepHours >= 9) sleep = 8
  else sleep = Math.min(a.currentSleepHours + 0.5, 8)
  if (age < 18) sleep = Math.max(sleep, 8.5)
  if (age > 60) sleep = Math.max(sleep, 7.5)

  // Screen time — 15% below today's habit, within sensible bounds
  let screen = clamp(Math.round(a.currentScreenHours * 60 * 0.85), 60, 300)
  if (a.primaryGoal === 'reduce-stress') screen = Math.min(screen, 180)
  if (a.primaryGoal === 'better-sleep') screen = Math.min(screen, 120)
  screen = roundTo(screen, 15)

  // Social and entertainment limits are shares of the overall screen goal
  const social = Math.max(30, roundTo(screen * 0.3, 15))
  const entertainment = Math.max(30, roundTo(screen * 0.35, 15))

  // Focus — driven by what the user wants to achieve, not how physically active they are
  const focusByGoal: Record<string, number> = {
    'build-habits': 90,
    'reduce-stress': 45,
    'better-sleep': 45,
  }
  const focus = focusByGoal[a.primaryGoal] ?? 60

  const ecoBase: Record<string, number> = { rarely: 1, sometimes: 2, often: 3, always: 4 }
  let eco = ecoBase[a.ecoConsciousness] ?? 2
  if (a.primaryGoal === 'eco-lifestyle') eco = Math.min(eco + 1, 5)

  return {
    goalStepsPerDay: roundTo(steps, 500),
    goalSleepHours: roundTo(sleep, 0.5),
    goalScreenMinutes: screen,
    goalFocusMinutes: focus,
    goalEcoActionsPerDay: eco,
    goalSocialMinutes: social,
    goalEntertainmentMinutes: entertainment,
    goalCaloriesPerDay: calculateCalorieGoal(a),
  }
}
