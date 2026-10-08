import { FastifyInstance } from 'fastify'
import { authenticate } from '../middleware/authenticate'
import { prisma } from '../db/prisma'
import { computeDailyScore } from '../services/ScoreService'
import { computeCyclePhase, computeSmartAverage } from './cycle'
import { APP_TIMEZONE, dayBounds } from '../utils/day'

// ---------------------------------------------------------------------------
// Local types for reduce/map callbacks
// ---------------------------------------------------------------------------
interface ProductivityItem  { durationSec: number; kind: string }
interface NutritionItem     { foodName: string; calories: number; mealType: string }
interface EcoItem           { category: string; type: string; impactKgCO2: number }

// ---------------------------------------------------------------------------
// Build a rich context summary of the user's current state
// This is injected into every coach conversation so it knows everything
// ---------------------------------------------------------------------------
async function buildUserContext(userId: string): Promise<string> {
  const { start: today, end: tomorrow } = dayBounds()
  const range = { gte: today, lt: tomorrow }

  // Fetch everything in parallel — today's score carries the effective goals and streak
  const [
    profile,
    todayPhysical,
    todayDigital,
    todayProductivity,
    todayMood,
    todayEco,
    todayNutrition,
    todayWater,
    cycleLatest,
    recentCycles,
    score,
  ] = await Promise.all([
    prisma.userProfile.findUnique({
      where: { userId },
      select: { gender: true, primaryGoal: true, hasDisability: true, defaultCycleLength: true },
    }),
    prisma.physicalActivityEntry.findMany({
      where: { userId, timestamp: range },
      select: { steps: true, distanceKm: true, sleepMinutes: true, caloriesKcal: true },
    }),
    prisma.digitalUsageEntry.findMany({
      where: { userId, date: range },
      select: { screenTimeMinutes: true, categoryBreakdown: true },
    }),
    prisma.productivitySession.findMany({
      where: { userId, startedAt: range },
      select: { durationSec: true, kind: true },
    }),
    prisma.moodLog.findFirst({
      where: { userId, timestamp: range },
      orderBy: { timestamp: 'desc' },
      select: { emoji: true, stressScore: true },
    }),
    prisma.ecoAction.findMany({
      where: { userId, timestamp: range },
      select: { category: true, type: true, impactKgCO2: true },
    }),
    prisma.nutritionLog.findMany({
      where: { userId, timestamp: range },
      select: { foodName: true, calories: true, mealType: true },
    }),
    prisma.waterLog.findMany({
      where: { userId, timestamp: range },
      select: { glasses: true },
    }),
    prisma.cycleLog.findFirst({
      where: { userId },
      orderBy: { periodStartDate: 'desc' },
      select: { periodStartDate: true, cycleLength: true, symptoms: true },
    }),
    prisma.cycleLog.findMany({
      where: { userId },
      orderBy: { periodStartDate: 'desc' },
      take: 6,
      select: { periodStartDate: true, periodDuration: true, actualCycleLength: true },
    }),
    computeDailyScore(userId),
  ])

  const { goals, streak } = score

  // ── Today's totals (there can be several entries per day) ───────────────
  const steps = todayPhysical.reduce((s, e) => s + e.steps, 0)
  const sleepMinutes = todayPhysical.reduce((s, e) => s + e.sleepMinutes, 0)
  const distanceKm = todayPhysical.reduce((s, e) => s + e.distanceKm, 0)
  const burned = todayPhysical.reduce((s, e) => s + e.caloriesKcal, 0)
  const screenMinutes = todayDigital.reduce((s, e) => s + e.screenTimeMinutes, 0)
  const waterGlasses = todayWater.reduce((s, e) => s + e.glasses, 0)
  const notLogged = (Object.keys(score.logged) as (keyof typeof score.logged)[])
    .filter((k) => !score.logged[k])

  const focusMin = Math.round(
    todayProductivity.reduce((s: number, p: ProductivityItem) => s + p.durationSec, 0) / 60
  )
  const totalCalories = Math.round(
    todayNutrition.reduce((s: number, n: NutritionItem) => s + n.calories, 0)
  )

  // ── Cycle phase — same calculation as the cycle tracker ─────────────────
  let cycleContext = ''
  if (cycleLatest && profile?.gender === 'female') {
    const avg = computeSmartAverage(recentCycles, profile.defaultCycleLength ?? cycleLatest.cycleLength)
    const c = computeCyclePhase(cycleLatest.periodStartDate, avg.cycleLength, avg.periodDuration)
    const status = c.periodActive
      ? 'Period currently active'
      : c.isLate
        ? `Period is ${c.daysLate} day${c.daysLate === 1 ? '' : 's'} late (expected ${c.nextPeriodDate})`
        : c.periodDueToday
          ? 'Period expected today'
          : `Days until next period: ${c.daysUntilNextPeriod + 1}`

    cycleContext = `
CYCLE TRACKING (private — never mention this unless directly asked):
  Current phase: ${c.phase} (Day ${c.dayOfCycle} of ${avg.cycleLength})
  ${status}
  Avg cycle length: ${avg.cycleLength} days (based on ${recentCycles.length} logged cycles)
  ${Array.isArray(cycleLatest.symptoms) && (cycleLatest.symptoms as string[]).length > 0
    ? `Recent symptoms: ${(cycleLatest.symptoms as string[]).join(', ')}`
    : ''}`
  }

  // ── Digital breakdown (summed across today's entries) ───────────────────
  const breakdown: Record<string, number> = {}
  for (const e of todayDigital) {
    for (const [k, v] of Object.entries((e.categoryBreakdown ?? {}) as Record<string, number>)) {
      breakdown[k] = (breakdown[k] ?? 0) + v
    }
  }
  const digitalBreakdown = Object.entries(breakdown).map(([k, v]) => `${k}: ${v}min`).join(', ')

  // ── Build the full context string ──────────────────────────────────────
  return `You are the LivoraPulse Wellness Coach — a knowledgeable, warm and practical wellness advisor.
You have full access to this user's real-time health data. Use it to give specific, personalised advice.
Today is ${today.toLocaleDateString('en-KE', { timeZone: APP_TIMEZONE, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.

USER PROFILE:
  Primary goal: ${profile?.primaryGoal ?? 'not set'}
  Gender: ${profile?.gender ?? 'not specified'}
  ${profile?.hasDisability ? 'Has physical limitations/disability' : ''}

TODAY'S DATA:
  LifePulse Score today: ${score.score}/100 (physical ${score.components.physical}, digital ${score.components.digital}, productivity ${score.components.productivity}, mood ${score.components.mood}, eco ${score.components.eco}, nutrition ${score.components.nutrition})
  Not logged yet today: ${notLogged.join(', ') || 'nothing, everything is logged'}

  Steps: ${steps} / ${goals.goalStepsPerDay} goal
  Sleep: ${sleepMinutes ? `${(sleepMinutes / 60).toFixed(1)}h` : 'not logged'} / ${goals.goalSleepHours}h goal
  Distance: ${distanceKm.toFixed(1)} km
  Calories burned: ${burned} kcal
  
  Screen time: ${screenMinutes}min / ${goals.goalScreenMinutes}min limit (social limit ${goals.goalSocialMinutes}min, entertainment limit ${goals.goalEntertainmentMinutes}min)
  ${digitalBreakdown ? `  Breakdown: ${digitalBreakdown}` : ''}
  
  Focus time: ${focusMin}min / ${goals.goalFocusMinutes}min goal
  
  Mood: ${todayMood?.emoji ?? 'not logged'} | Stress: ${todayMood ? `${todayMood.stressScore}/10 (1 = very calm, 10 = very stressed)` : 'not logged'}
  
  Eco actions today: ${todayEco.length} (${todayEco.map((e: EcoItem) => e.type).join(', ') || 'none'})
  
  Nutrition logged: ${totalCalories} kcal / ${goals.goalCaloriesPerDay} kcal goal
  Meals: ${todayNutrition.length > 0 ? todayNutrition.map((n: NutritionItem) => `${n.foodName} (${n.mealType})`).join(', ') : 'none logged'}
  Water: ${waterGlasses} / 8 glasses
  
  Current streak: ${streak} day${streak !== 1 ? 's' : ''} (targets x${score.multiplier})
${cycleContext}

GOALS FOR TODAY (already adjusted for the streak):
  Steps/day: ${goals.goalStepsPerDay}
  Sleep: ${goals.goalSleepHours}h
  Screen time limit: ${goals.goalScreenMinutes}min
  Focus goal: ${goals.goalFocusMinutes}min
  Calories: ${goals.goalCaloriesPerDay} kcal/day
  Eco actions/day: ${goals.goalEcoActionsPerDay}

RESPONSE STYLE:
  - Be specific — reference actual numbers from the user's data
  - Be warm and encouraging, not preachy
  - Keep responses concise (2-4 sentences for simple questions, up to a paragraph for complex ones)
  - If data is missing for a dimension, acknowledge it gently
  - Never reveal cycle data unless the user explicitly asks about it
  - For Kenyan food questions, you know the local food database includes ugali, sukuma wiki, nyama choma, chai, mandazi etc.`
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
export async function aiRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  // POST /api/ai/chat
  app.post('/chat', async (request, reply) => {
    const userId = request.user!.id
    const { messages } = request.body as {
      messages: Array<{ role: 'user' | 'assistant'; content: string }>
    }

    if (!messages?.length) {
      return reply.status(400).send({ success: false, error: 'No messages provided' })
    }

    // Build context — inject as system message
    const systemContext = await buildUserContext(userId)

    // Call Anthropic API
    const anthropicKey = process.env.ANTHROPIC_API_KEY
    if (!anthropicKey) {
      return reply.status(500).send({ success: false, error: 'AI service not configured' })
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system: systemContext,
        messages: messages.slice(-10), // Keep last 10 messages for context window
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('[AI Coach] Anthropic error:', err)
      return reply.status(502).send({ success: false, error: 'AI service temporarily unavailable' })
    }

    const data = await response.json() as {
      content: Array<{ type: string; text: string }>
    }

    const reply_text = data.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('')

    return reply.send({ success: true, data: { reply: reply_text } })
  })
}