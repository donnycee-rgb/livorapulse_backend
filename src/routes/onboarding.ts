import { FastifyInstance } from 'fastify'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { onboardingSchema } from '../schemas/onboarding.schema'
import { prisma } from '../db/prisma'

// ---------------------------------------------------------------------------
// Goal calculation from onboarding answers
// ---------------------------------------------------------------------------
function calculateGoals(input: {
  dateOfBirth: string
  hasDisability: boolean
  primaryGoal: string
  currentActivityLevel: string
  currentSleepHours: number
  currentScreenHours: number
  ecoConsciousness: string
  weightKg?: number
}) {
  const age = Math.floor(
    (Date.now() - new Date(input.dateOfBirth).getTime()) / (365.25 * 24 * 60 * 60 * 1000)
  )

  // Base step goal from activity level
  const baseSteps: Record<string, number> = {
    sedentary: 4000,
    light: 6000,
    moderate: 8000,
    active: 10000,
    'very-active': 12000,
  }
  let goalStepsPerDay = baseSteps[input.currentActivityLevel] ?? 6000

  // Adjust for age
  if (age > 60) goalStepsPerDay = Math.min(goalStepsPerDay, 6000)
  if (age < 18) goalStepsPerDay = Math.min(goalStepsPerDay, 8000)

  // Adjust for disability
  if (input.hasDisability) goalStepsPerDay = Math.min(goalStepsPerDay, 3000)

  // Adjust for primary goal
  if (input.primaryGoal === 'lose-weight') goalStepsPerDay += 1000
  if (input.primaryGoal === 'improve-fitness') goalStepsPerDay += 2000

  // Sleep goal — based on current + nudge toward healthy
  let goalSleepHours = input.currentSleepHours
  if (input.currentSleepHours < 6) goalSleepHours = 7
  else if (input.currentSleepHours < 7) goalSleepHours = 7.5
  else if (input.currentSleepHours >= 9) goalSleepHours = 8
  else goalSleepHours = Math.min(input.currentSleepHours + 0.5, 8)
  if (age < 18) goalSleepHours = Math.max(goalSleepHours, 8.5)
  if (age > 60) goalSleepHours = Math.max(goalSleepHours, 7.5)

  // Screen time goal — current minus 10-20% nudge
  const currentScreenMin = input.currentScreenHours * 60
  let goalScreenMinutes = Math.round(currentScreenMin * 0.85)
  goalScreenMinutes = Math.max(60, Math.min(goalScreenMinutes, 300))
  if (input.primaryGoal === 'reduce-stress') goalScreenMinutes = Math.min(goalScreenMinutes, 180)
  if (input.primaryGoal === 'better-sleep') goalScreenMinutes = Math.min(goalScreenMinutes, 120)

  // Focus goal — from activity level
  const baseFocus: Record<string, number> = {
    sedentary: 30,
    light: 45,
    moderate: 60,
    active: 90,
    'very-active': 120,
  }
  let goalFocusMinutes = baseFocus[input.currentActivityLevel] ?? 60
  if (input.primaryGoal === 'build-habits') goalFocusMinutes += 30
  if (input.primaryGoal === 'reduce-stress') goalFocusMinutes = Math.min(goalFocusMinutes, 60)

  // Eco actions goal
  const ecoBase: Record<string, number> = {
    rarely: 1,
    sometimes: 2,
    often: 3,
    always: 4,
  }
  const goalEcoActionsPerDay = ecoBase[input.ecoConsciousness] ?? 2

  return {
    goalStepsPerDay: Math.round(goalStepsPerDay / 500) * 500, // round to nearest 500
    goalSleepHours: Math.round(goalSleepHours * 2) / 2,       // round to nearest 0.5
    goalScreenMinutes: Math.round(goalScreenMinutes / 15) * 15, // round to nearest 15
    goalFocusMinutes: Math.round(goalFocusMinutes / 15) * 15,
    goalEcoActionsPerDay,
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
export async function onboardingRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  // POST /api/user/onboarding — save onboarding data and calculated goals
  app.post('/', async (request, reply) => {
    const body = validate(onboardingSchema, request.body)
    const userId = request.user!.id

    const goals = calculateGoals({
      dateOfBirth: body.dateOfBirth,
      hasDisability: body.hasDisability,
      primaryGoal: body.primaryGoal,
      currentActivityLevel: body.currentActivityLevel,
      currentSleepHours: body.currentSleepHours,
      currentScreenHours: body.currentScreenHours,
      ecoConsciousness: body.ecoConsciousness,
      weightKg: body.weightKg,
    })

    const profile = await prisma.userProfile.upsert({
      where: { userId },
      create: {
        userId,
        dateOfBirth: new Date(body.dateOfBirth),
        gender: body.gender,
        heightCm: body.heightCm,
        weightKg: body.weightKg,
        hasDisability: body.hasDisability,
        disabilityNote: body.disabilityNote,
        primaryGoal: body.primaryGoal,
        onboardingComplete: true,
        ...goals,
      },
      update: {
        dateOfBirth: new Date(body.dateOfBirth),
        gender: body.gender,
        heightCm: body.heightCm,
        weightKg: body.weightKg,
        hasDisability: body.hasDisability,
        disabilityNote: body.disabilityNote,
        primaryGoal: body.primaryGoal,
        onboardingComplete: true,
        ...goals,
      },
      select: {
        onboardingComplete: true,
        primaryGoal: true,
        goalStepsPerDay: true,
        goalSleepHours: true,
        goalScreenMinutes: true,
        goalFocusMinutes: true,
        goalEcoActionsPerDay: true,
      },
    })

    return reply.send({ success: true, data: { profile, goals } })
  })

  // GET /api/user/onboarding — get current profile and goals
  app.get('/', async (request, reply) => {
    const profile = await prisma.userProfile.findUnique({
      where: { userId: request.user!.id },
      select: {
        dateOfBirth: true,
        gender: true,
        heightCm: true,
        weightKg: true,
        hasDisability: true,
        primaryGoal: true,
        onboardingComplete: true,
        goalStepsPerDay: true,
        goalSleepHours: true,
        goalScreenMinutes: true,
        goalFocusMinutes: true,
        goalEcoActionsPerDay: true,
      },
    })

    return reply.send({ success: true, data: profile ?? null })
  })
  // PUT /api/user/onboarding/goals — update just the goals
  app.put('/goals', async (request, reply) => {
    const body = request.body as Record<string, number>
    const userId = request.user!.id

    const allowed = [
      'goalStepsPerDay', 'goalSleepHours', 'goalScreenMinutes',
      'goalFocusMinutes', 'goalEcoActionsPerDay',
      'goalSocialMinutes', 'goalEntertainmentMinutes',
    ]
    const data: Record<string, number> = {}
    for (const key of allowed) {
      if (body[key] !== undefined && typeof body[key] === 'number') {
        data[key] = body[key]
      }
    }

    const profile = await prisma.userProfile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
      select: {
        goalStepsPerDay: true,
        goalSleepHours: true,
        goalScreenMinutes: true,
        goalFocusMinutes: true,
        goalEcoActionsPerDay: true,
      },
    })

    return reply.send({ success: true, data: profile })
  })
}