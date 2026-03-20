import { prisma } from '../db/prisma'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScoreComponents {
  physical: number
  digital: number
  productivity: number
  mood: number
  eco: number
  nutrition: number
}

export interface DailyScoreResult {
  date: string
  score: number
  insight: string
  components: ScoreComponents
}

// ─── Default goals — used when user has no profile yet ───────────────────────

const DEFAULT_GOALS = {
  goalStepsPerDay: 8000,
  goalSleepHours: 8,
  goalScreenMinutes: 240,
  goalFocusMinutes: 120,
  goalEcoActionsPerDay: 3,
  goalSocialMinutes: 60,
  goalEntertainmentMinutes: 90,
}

// ─── Streak multiplier — mirrors frontend selectors.ts ───────────────────────

function getStreakMultiplier(streak: number): number {
  if (streak >= 60) return 1.50
  if (streak >= 30) return 1.35
  if (streak >= 14) return 1.20
  if (streak >= 7)  return 1.10
  return 1.00
}

// ─── Day boundary helpers ─────────────────────────────────────────────────────

function dayBounds(date: Date): { start: Date; end: Date } {
  const start = new Date(date)
  start.setUTCHours(0, 0, 0, 0)
  const end = new Date(date)
  end.setUTCHours(23, 59, 59, 999)
  return { start, end }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

// ─── Component score calculations — all personalised ────────────────────────

function physicalScore(
  steps: number,
  sleepMinutes: number,
  goalSteps: number,
  goalSleepHours: number,
): number {
  const stepsScore = clamp((steps / goalSteps) * 100, 0, 100)
  const sleepScore = clamp((sleepMinutes / (goalSleepHours * 60)) * 100, 0, 100)
  return stepsScore * 0.7 + sleepScore * 0.3
}

function digitalScore(
  socialMinutes: number,
  entertainmentMinutes: number,
  productiveMinutes: number,
  goalSocialMinutes: number,
  goalEntertainmentMinutes: number,
  goalFocusMinutes: number,
): number {
  // Productive screen time — no penalty, boosts productivity instead
  // Social — penalised only beyond the personal limit
  const socialPenalty = socialMinutes > goalSocialMinutes
    ? clamp(((socialMinutes - goalSocialMinutes) / goalSocialMinutes) * 50, 0, 50)
    : 0

  // Entertainment — penalised only beyond the personal limit
  const entertainPenalty = entertainmentMinutes > goalEntertainmentMinutes
    ? clamp(((entertainmentMinutes - goalEntertainmentMinutes) / goalEntertainmentMinutes) * 50, 0, 50)
    : 0

  return clamp(100 - socialPenalty - entertainPenalty, 0, 100)
}

function productivityScore(
  totalFocusSec: number,
  productiveScreenMinutes: number,
  goalFocusMinutes: number,
): number {
  const focusMin = totalFocusSec / 60

  // Productive screen time contributes up to 30% of the focus goal
  const productiveBonus = clamp((productiveScreenMinutes / goalFocusMinutes) * 30, 0, 30)
  const focusContribution = clamp((focusMin / goalFocusMinutes) * 100, 0, 100)

  return clamp(focusContribution * 0.7 + productiveBonus * 0.3, 0, 100)
}

function moodScore(avgStress: number): number {
  const raw = (10 - avgStress) * 10 + 10
  return clamp(raw, 0, 100)
}

function ecoScore(actionCount: number, goalEcoActions: number): number {
  return clamp((actionCount / goalEcoActions) * 100, 0, 100)
}

function nutritionScore(totalCalories: number, goalCalories: number): number {
  if (totalCalories === 0) return 50 // neutral — don't punish for not logging
  return clamp((totalCalories / goalCalories) * 100, 0, 100)
}

function buildInsight(
  components: ScoreComponents,
  goals: typeof DEFAULT_GOALS,
  streak: number,
): string {
  const entries = Object.entries(components) as [keyof ScoreComponents, number][]
  const [lowest] = entries.reduce((a, b) => (a[1] <= b[1] ? a : b))

  const messages: Record<keyof ScoreComponents, string> = {
    physical: `Try to hit ${goals.goalStepsPerDay.toLocaleString()} steps today to boost your physical score.`,
    digital: 'Your social or entertainment screen time is high — try staying within your personal limits.',
    productivity: `Even one focused session can help you reach your ${goals.goalFocusMinutes}-minute focus goal.`,
    mood: 'Your stress levels look high — try a short breathing exercise or a walk.',
    eco: 'Log an eco action today to improve your sustainability score.',
    nutrition: 'Log your meals on the Nutrition page to keep your nutrition score on track.',
  }

  if (streak >= 7) {
    const [highest] = entries.reduce((a, b) => (a[1] >= b[1] ? a : b))
    if (components[highest] >= 80) {
      return `${streak}-day streak! Your ${highest} score is strong — keep it going.`
    }
  }

  return messages[lowest]
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function computeDailyScore(
  userId: string,
  date: Date,
): Promise<DailyScoreResult> {
  const { start, end } = dayBounds(date)

  // Fetch all data in parallel — including user profile for personal goals
  const [physical, digital, productivity, mood, eco, nutrition, profile, streakRaw] = await Promise.all([
    prisma.physicalActivityEntry.findMany({
      where: { userId, timestamp: { gte: start, lte: end } },
      select: { steps: true, sleepMinutes: true },
    }),
    prisma.digitalUsageEntry.findMany({
      where: { userId, date: { gte: start, lte: end } },
      select: { screenTimeMinutes: true, categoryBreakdown: true },
    }),
    prisma.productivitySession.findMany({
      where: { userId, startedAt: { gte: start, lte: end } },
      select: { durationSec: true },
    }),
    prisma.moodLog.findMany({
      where: { userId, timestamp: { gte: start, lte: end } },
      select: { stressScore: true },
    }),
    prisma.ecoAction.findMany({
      where: { userId, timestamp: { gte: start, lte: end } },
      select: { id: true },
    }),
    prisma.nutritionLog.findMany({
      where: { userId, timestamp: { gte: start, lte: end } },
      select: { calories: true },
    }),
    prisma.userProfile.findUnique({
      where: { userId },
      select: {
        goalStepsPerDay: true,
        goalSleepHours: true,
        goalScreenMinutes: true,
        goalFocusMinutes: true,
        goalEcoActionsPerDay: true,
        goalSocialMinutes: true,
        goalEntertainmentMinutes: true,
        goalCaloriesPerDay: true,
      },
    }),
    // Get streak from Redis if available — fall back to 0
    import('../db/redis').then(({ redis }) =>
      redis.get(`streak:${userId}`).catch(() => null)
    ).catch(() => null),
  ])

  // ── Personal goals with streak progression ──────────────────────────────
  const streak = streakRaw ? parseInt(String(streakRaw), 10) : 0
  const multiplier = getStreakMultiplier(streak)

  const baseGoals = {
    goalStepsPerDay:          profile?.goalStepsPerDay          ?? DEFAULT_GOALS.goalStepsPerDay,
    goalSleepHours:           profile?.goalSleepHours           ?? DEFAULT_GOALS.goalSleepHours,
    goalScreenMinutes:        profile?.goalScreenMinutes        ?? DEFAULT_GOALS.goalScreenMinutes,
    goalFocusMinutes:         profile?.goalFocusMinutes         ?? DEFAULT_GOALS.goalFocusMinutes,
    goalEcoActionsPerDay:     profile?.goalEcoActionsPerDay     ?? DEFAULT_GOALS.goalEcoActionsPerDay,
    goalSocialMinutes:        profile?.goalSocialMinutes        ?? DEFAULT_GOALS.goalSocialMinutes,
    goalEntertainmentMinutes: profile?.goalEntertainmentMinutes ?? DEFAULT_GOALS.goalEntertainmentMinutes,
    goalCaloriesPerDay:       profile?.goalCaloriesPerDay        ?? 2000,
  }

  // Apply streak progression — upward goals increase, screen limits decrease
  const goals = {
    goalStepsPerDay:          Math.round((baseGoals.goalStepsPerDay * multiplier) / 500) * 500,
    goalSleepHours:           Math.min(Math.round(baseGoals.goalSleepHours * multiplier * 2) / 2, 9),
    goalFocusMinutes:         Math.round((baseGoals.goalFocusMinutes * multiplier) / 15) * 15,
    goalEcoActionsPerDay:     Math.min(Math.round(baseGoals.goalEcoActionsPerDay * multiplier), 8),
    // Screen limits go DOWN as streak grows
    goalSocialMinutes:        Math.round(baseGoals.goalSocialMinutes / multiplier),
    goalEntertainmentMinutes: Math.round(baseGoals.goalEntertainmentMinutes / multiplier),
    goalScreenMinutes:        Math.round(baseGoals.goalScreenMinutes / multiplier),
    goalCaloriesPerDay:       profile?.goalCaloriesPerDay ?? 2000,
  }

  // ── Aggregate raw values ────────────────────────────────────────────────
  const totalSteps = physical.reduce((s, e) => s + e.steps, 0)
  const totalSleepMin = physical.reduce((s, e) => s + e.sleepMinutes, 0)
  const totalFocusSec = productivity.reduce((s, e) => s + e.durationSec, 0)
  const avgStress = mood.length > 0
    ? mood.reduce((s, e) => s + e.stressScore, 0) / mood.length
    : 5
  const ecoCount = eco.length
  const totalCalories = nutrition.reduce((s, e) => s + e.calories, 0)

  // Extract category breakdown from digital entries
  let socialMin = 0
  let entertainMin = 0
  let productiveMin = 0

  digital.forEach((e) => {
    const bd = e.categoryBreakdown as Record<string, number>
    socialMin      += bd['Social']        ?? 0
    entertainMin   += bd['Entertainment'] ?? 0
    productiveMin  += bd['Productive']    ?? 0
  })

  // ── Compute component scores ────────────────────────────────────────────
  const components: ScoreComponents = {
    physical: Math.round(physicalScore(
      totalSteps, totalSleepMin,
      goals.goalStepsPerDay, goals.goalSleepHours,
    )),
    digital: Math.round(digitalScore(
      socialMin, entertainMin, productiveMin,
      goals.goalSocialMinutes, goals.goalEntertainmentMinutes, goals.goalFocusMinutes,
    )),
    productivity: Math.round(productivityScore(
      totalFocusSec, productiveMin, goals.goalFocusMinutes,
    )),
    mood: Math.round(moodScore(avgStress)),
    eco: Math.round(ecoScore(ecoCount, goals.goalEcoActionsPerDay)),
    nutrition: Math.round(nutritionScore(totalCalories, goals.goalCaloriesPerDay)),
  }

  // ── Weighted total ──────────────────────────────────────────────────────
  const score = Math.round(
    components.physical     * 0.23 +
    components.digital      * 0.18 +
    components.productivity * 0.20 +
    components.mood         * 0.14 +
    components.eco          * 0.14 +
    components.nutrition    * 0.11,
  )

  const insight = buildInsight(components, baseGoals, streak)
  const dateStr = start.toISOString().slice(0, 10)

  // ── Persist to DailySummary ─────────────────────────────────────────────
  await prisma.dailySummary.upsert({
    where: { userId_date: { userId, date: start } },
    create: {
      userId, date: start,
      insightText: insight,
      physicalScore: components.physical,
      digitalScore: components.digital,
      productivityScore: components.productivity,
      moodScore: components.mood,
      ecoScore: components.eco,
    },
    update: {
      insightText: insight,
      physicalScore: components.physical,
      digitalScore: components.digital,
      productivityScore: components.productivity,
      moodScore: components.mood,
      ecoScore: components.eco,
    },
  })

  return { date: dateStr, score, insight, components }
}