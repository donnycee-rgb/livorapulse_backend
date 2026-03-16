import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { z } from 'zod'
import { prisma } from '../db/prisma'
import { redis } from '../db/redis'

// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------
const chatSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string().min(1).max(4000),
    }),
  ).min(1).max(20),
})

// ---------------------------------------------------------------------------
// Build system prompt from user's real data (server-side)
// ---------------------------------------------------------------------------
async function buildSystemPrompt(userId: string): Promise<string> {
  const now = new Date()
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date(todayStart)
  todayEnd.setDate(todayEnd.getDate() + 1)

  const weekStart = new Date(now)
  weekStart.setDate(weekStart.getDate() - 7)
  weekStart.setHours(0, 0, 0, 0)

  const [user, physical, digital, productivity, mood, eco, streakRaw] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    }),
    prisma.physicalActivityEntry.findMany({
      where: { userId, timestamp: { gte: todayStart, lt: todayEnd } },
    }),
    prisma.digitalUsageEntry.findMany({
      where: { userId, date: { gte: todayStart, lt: todayEnd } },
    }),
    prisma.productivitySession.findMany({
      where: { userId, startedAt: { gte: todayStart, lt: todayEnd } },
    }),
    prisma.moodLog.findMany({
      where: { userId, timestamp: { gte: todayStart, lt: todayEnd } },
      orderBy: { timestamp: 'desc' },
      take: 1,
    }),
    prisma.ecoAction.findMany({
      where: { userId, timestamp: { gte: todayStart, lt: todayEnd } },
    }),
    redis.get(`streak:${userId}`),
  ])

  const firstName = user?.name.trim().split(/\s+/)[0] ?? 'there'
  const streak = streakRaw ? parseInt(streakRaw, 10) : 0

  const steps = physical.reduce((s, e) => s + e.steps, 0)
  const sleepHours = physical.reduce((s, e) => s + e.sleepMinutes, 0) / 60
  const distanceKm = physical.reduce((s, e) => s + e.distanceKm, 0)
  const calories = physical.reduce((s, e) => s + e.caloriesKcal, 0)
  const screenMin = digital.reduce((s, e) => s + e.screenTimeMinutes, 0)
  const focusMin = productivity.reduce((s, e) => s + Math.round(e.durationSec / 60), 0)
  const latestMood = mood[0]
  const ecoCount = eco.length

  const physicalScore = Math.round(Math.min(
    0.7 * (steps / 8000) * 100 + 0.3 * (sleepHours / 8) * 100, 100,
  ))
  const digitalScore = Math.round(Math.max(0, Math.min(110 - (screenMin / 240) * 100, 100)))
  const productivityScore = Math.round(Math.min((focusMin / 120) * 100, 100))
  const ecoScore = Math.round(Math.min(ecoCount * 25, 100))
  const moodScore = latestMood
    ? Math.round(Math.max(0, 100 - (latestMood.stressScore / 10) * 100))
    : 60

  const overallScore = Math.round(
    0.26 * physicalScore +
    0.20 * digitalScore +
    0.22 * productivityScore +
    0.16 * moodScore +
    0.16 * ecoScore,
  )

  // Weekly data
  const weeklyPhysical = await prisma.physicalActivityEntry.findMany({
    where: { userId, timestamp: { gte: weekStart } },
  })
  const weeklyFocus = await prisma.productivitySession.findMany({
    where: { userId, startedAt: { gte: weekStart } },
  })
  const weeklyScreen = await prisma.digitalUsageEntry.findMany({
    where: { userId, date: { gte: weekStart } },
  })

  const weeklySteps = weeklyPhysical.reduce((s, e) => s + e.steps, 0)
  const weeklyFocusMin = weeklyFocus.reduce((s, e) => s + Math.round(e.durationSec / 60), 0)
  const weeklyScreenMin = weeklyScreen.reduce((s, e) => s + e.screenTimeMinutes, 0)

  const moodLabel = latestMood
    ? latestMood.stressScore <= 2 ? 'Low stress'
    : latestMood.stressScore <= 3 ? 'Moderate stress'
    : 'High stress'
    : 'Not logged'

  return `You are the LivoraPulse AI Wellness Coach — a data-driven personal wellness advisor with access to ${firstName}'s real health data.

USER: ${user?.name ?? 'User'}
STREAK: ${streak} days
OVERALL LIFEPULSE SCORE: ${overallScore}/100

TODAY:
- Steps: ${steps.toLocaleString()} / 8,000 goal
- Distance: ${distanceKm.toFixed(1)} km
- Calories burned: ${calories} kcal
- Sleep: ${sleepHours > 0 ? `${sleepHours.toFixed(1)}h` : 'not logged'}
- Screen time: ${screenMin > 0 ? `${Math.floor(screenMin / 60)}h ${screenMin % 60}m` : 'not logged'} (4h daily limit)
- Focus time: ${focusMin > 0 ? `${focusMin} minutes` : 'not logged'} (2h daily goal)
- Mood / Stress: ${moodLabel}
- Eco actions: ${ecoCount}

THIS WEEK:
- Total steps: ${weeklySteps.toLocaleString()}
- Total focus: ${weeklyFocusMin} minutes
- Total screen time: ${Math.floor(weeklyScreenMin / 60)}h ${weeklyScreenMin % 60}m

DIMENSION SCORES:
- Physical: ${physicalScore}/100
- Digital: ${digitalScore}/100
- Productivity: ${productivityScore}/100
- Mental/Mood: ${moodScore}/100
- Eco: ${ecoScore}/100

RESPONSE FORMAT — FOLLOW STRICTLY:
- Maximum 3 sentences per response unless the user explicitly asks for a full breakdown or summary
- Never use bullet points or lists unless explicitly asked
- Never repeat information already mentioned
- One specific actionable suggestion at the end maximum
- If the answer is simple, one sentence is enough
- Never pad responses with filler phrases like "Great question" or "I hope this helps"
- Never use emojis
- Address ${firstName} by first name only occasionally, not every message`
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------
export async function aiRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  app.post('/chat', async (request: FastifyRequest, reply: FastifyReply) => {
    const apiKey = process.env.GROQ_API_KEY
    if (!apiKey) {
      return reply.code(503).send({
        success: false,
        error: 'AI coach is not configured on this server.',
      })
    }

    const body = validate(chatSchema, request.body)
    const userId = request.user!.id

    // Build system prompt from real database data server-side
    const systemPrompt = await buildSystemPrompt(userId)

    // Call Groq API server-side — API key never leaves the server
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        max_tokens: 300,
        messages: [
          { role: 'system', content: systemPrompt },
          ...body.messages,
        ],
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      app.log.error(`Groq API error: ${response.status} ${err}`)
      return reply.code(502).send({
        success: false,
        error: 'Could not reach the AI service. Please try again.',
      })
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>
    }

    const replyText = data.choices[0]?.message?.content ?? 'I could not generate a response. Please try again.'

    return reply.send({ success: true, data: { reply: replyText } })
  })
}