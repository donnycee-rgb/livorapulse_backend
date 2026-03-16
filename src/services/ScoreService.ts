import { prisma } from '../db/prisma'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScoreComponents {
  physical: number
  digital: number
  productivity: number
  mood: number
  eco: number
}

export interface DailyScoreResult {
  date: string
  score: number
  insight: string
  components: ScoreComponents
}

// ─── Day boundary helpers ─────────────────────────────────────────────────────

function dayBounds(date: Date): { start: Date; end: Date } {
  const start = new Date(date)
  start.setUTCHours(0, 0, 0, 0)
  const end = new Date(date)
  end.setUTCHours(23, 59, 59, 999)
  return { start, end }
}

// ─── Component score calculations ────────────────────────────────────────────

function physicalScore(steps: number, sleepMinutes: number): number {
  let stepsScore: number
  if (steps >= 10000) stepsScore = 100
  else if (steps >= 7500) stepsScore = 80
  else if (steps >= 5000) stepsScore = 60
  else if (steps >= 2500) stepsScore = 40
  else stepsScore = 20

  let sleepScore: number
  if (sleepMinutes >= 480) sleepScore = 100
  else if (sleepMinutes >= 420) sleepScore = 80
  else if (sleepMinutes >= 360) sleepScore = 60
  else sleepScore = 40

  return stepsScore * 0.6 + sleepScore * 0.4
}

function digitalScore(screenTimeMinutes: number): number {
  if (screenTimeMinutes <= 120) return 100
  if (screenTimeMinutes <= 240) return 80
  if (screenTimeMinutes <= 360) return 60
  if (screenTimeMinutes <= 480) return 40
  return 20
}

function productivityScore(totalFocusSec: number): number {
  const hours = totalFocusSec / 3600
  if (hours >= 4) return 100
  if (hours >= 3) return 85
  if (hours >= 2) return 70
  if (hours >= 1) return 50
  return 25
}

function moodScore(avgStress: number): number {
  const raw = (10 - avgStress) * 10 + 10
  return Math.max(0, Math.min(100, raw))
}

function ecoScore(actionCount: number): number {
  if (actionCount === 0) return 40
  if (actionCount === 1) return 60
  if (actionCount === 2) return 75
  if (actionCount === 3) return 88
  return 100
}

function buildInsight(components: ScoreComponents): string {
  const entries = Object.entries(components) as [keyof ScoreComponents, number][]
  const [lowest] = entries.reduce((a, b) => (a[1] <= b[1] ? a : b))

  const messages: Record<keyof ScoreComponents, string> = {
    physical: 'Try to hit 10,000 steps today to boost your physical score.',
    digital: 'Consider reducing screen time — your eyes and mind will thank you.',
    productivity: 'Even one focused 25-minute session can improve your productivity score.',
    mood: 'Your stress levels look high — try a short breathing exercise.',
    eco: 'Log an eco action today to improve your sustainability score.',
  }
  return messages[lowest]
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function computeDailyScore(
  userId: string,
  date: Date,
): Promise<DailyScoreResult> {
  const { start, end } = dayBounds(date)

  const [physical, digital, productivity, mood, eco] = await Promise.all([
    prisma.physicalActivityEntry.findMany({
      where: { userId, timestamp: { gte: start, lte: end } },
      select: { steps: true, sleepMinutes: true },
    }),
    prisma.digitalUsageEntry.findMany({
      where: { userId, date: { gte: start, lte: end } },
      select: { screenTimeMinutes: true },
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
  ])

  // Aggregate raw values
  const totalSteps = physical.reduce((s, e) => s + e.steps, 0)
  const totalSleep = physical.reduce((s, e) => s + e.sleepMinutes, 0)
  const totalScreen = digital.reduce((s, e) => s + e.screenTimeMinutes, 0)
  const totalFocusSec = productivity.reduce((s, e) => s + e.durationSec, 0)
  const avgStress =
    mood.length > 0
      ? mood.reduce((s, e) => s + e.stressScore, 0) / mood.length
      : 5 // neutral default when no logs
  const ecoCount = eco.length

  const components: ScoreComponents = {
    physical: Math.round(physicalScore(totalSteps, totalSleep)),
    digital: Math.round(digitalScore(totalScreen)),
    productivity: Math.round(productivityScore(totalFocusSec)),
    mood: Math.round(moodScore(avgStress)),
    eco: Math.round(ecoScore(ecoCount)),
  }

  const score = Math.round(
    components.physical * 0.25 +
      components.digital * 0.2 +
      components.productivity * 0.25 +
      components.mood * 0.2 +
      components.eco * 0.1,
  )

  const insight = buildInsight(components)
  const dateStr = start.toISOString().slice(0, 10)

  // Upsert DailySummary — store component scores and insight; NOT the total score
  await prisma.dailySummary.upsert({
    where: { userId_date: { userId, date: start } },
    create: {
      userId,
      date: start,
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
