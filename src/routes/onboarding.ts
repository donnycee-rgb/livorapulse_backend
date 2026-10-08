import { FastifyInstance } from 'fastify'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { onboardingSchema } from '../schemas/onboarding.schema'
import { prisma } from '../db/prisma'
import { calculateGoals } from '../services/GoalService'
import { checkInSchema, updateGoalsSchema } from '../schemas/onboarding.schema'

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
export async function onboardingRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  // POST /api/user/onboarding — save onboarding data and calculated goals
  app.post('/', async (request, reply) => {
    // .parse (not validate()) so the defaults are reflected in the type
    const body = onboardingSchema.parse(request.body)
    const userId = request.user!.id

    const goals = calculateGoals(body)

    const profile = await prisma.userProfile.upsert({
      where: { userId },
      create: {
        userId,
        dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : undefined,
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
        // Skipped answers leave whatever is already stored
        ...(body.dateOfBirth && { dateOfBirth: new Date(body.dateOfBirth) }),
        ...(body.gender && { gender: body.gender }),
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
        goalSocialMinutes: true,
        goalEntertainmentMinutes: true,
        goalCaloriesPerDay: true,
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
        goalSocialMinutes: true,
        goalEntertainmentMinutes: true,
        goalCaloriesPerDay: true,
      },
    })

    return reply.send({ success: true, data: profile ?? null })
  })
  // POST /api/user/onboarding/checkin — weekly check-in: re-answer the goal
  // questions and recalculate goals, keeping the rest of the profile
  app.post('/checkin', async (request, reply) => {
    const body = checkInSchema.parse(request.body)
    const userId = request.user!.id

    const existing = await prisma.userProfile.findUnique({
      where: { userId },
      select: { dateOfBirth: true, gender: true, heightCm: true, weightKg: true, hasDisability: true },
    })
    // Works even if the user skipped their birth year during setup
    const weightKg = body.weightKg ?? existing?.weightKg ?? undefined
    const goals = calculateGoals({
      dateOfBirth: existing?.dateOfBirth?.toISOString(),
      gender: existing?.gender ?? 'prefer-not-to-say',
      heightCm: existing?.heightCm ?? undefined,
      weightKg,
      hasDisability: existing?.hasDisability ?? false,
      primaryGoal: body.primaryGoal,
      currentActivityLevel: body.currentActivityLevel,
      currentSleepHours: body.currentSleepHours,
      currentScreenHours: body.currentScreenHours,
      ecoConsciousness: body.ecoConsciousness,
    })

    const data = { primaryGoal: body.primaryGoal, ...(weightKg !== undefined && { weightKg }), ...goals }
    await prisma.userProfile.upsert({
      where: { userId },
      create: { userId, onboardingComplete: true, ...data },
      update: data,
    })
    return reply.send({ success: true, data: { goals } })
  })

  // PUT /api/user/onboarding/goals — update just the goals
  app.put('/goals', async (request, reply) => {
    // Every goal is optional, but any value sent must be within a sensible range
    const data = validate(updateGoalsSchema, request.body)
    const userId = request.user!.id

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
        goalSocialMinutes: true,
        goalEntertainmentMinutes: true,
        goalCaloriesPerDay: true,
      },
    })

    return reply.send({ success: true, data: profile })
  })
}