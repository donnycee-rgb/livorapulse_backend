import { z } from 'zod'

export const onboardingSchema = z.object({
  dateOfBirth: z.string().datetime(),
  gender: z.enum(['male', 'female', 'non-binary', 'prefer-not-to-say']),
  heightCm: z.number().positive().optional(),
  weightKg: z.number().positive().optional(),
  hasDisability: z.boolean(),
  disabilityNote: z.string().optional(),
  primaryGoal: z.enum([
    'lose-weight',
    'gain-muscle',
    'better-sleep',
    'reduce-stress',
    'build-habits',
    'improve-fitness',
    'eco-lifestyle',
  ]),
  // These are used to calculate goals — not stored directly
  currentSleepHours: z.number().min(0).max(24),
  currentActivityLevel: z.enum(['sedentary', 'light', 'moderate', 'active', 'very-active']),
  currentScreenHours: z.number().min(0).max(24),
  currentMood: z.enum(['thriving', 'balanced', 'struggling', 'overwhelmed', 'exhausted']),
  currentStress: z.enum(['very-calm', 'mild', 'moderate', 'high', 'burned-out']),
  ecoConsciousness: z.enum(['rarely', 'sometimes', 'often', 'always']),
})

export type OnboardingInput = z.infer<typeof onboardingSchema>

// Goals edited in Settings — ranges match GOAL_LIMITS in GoalService
export const updateGoalsSchema = z.object({
  goalStepsPerDay: z.number().int().min(1000).max(40000),
  goalSleepHours: z.number().min(4).max(12),
  goalScreenMinutes: z.number().int().min(30).max(960),
  goalFocusMinutes: z.number().int().min(10).max(600),
  goalEcoActionsPerDay: z.number().int().min(1).max(10),
  goalSocialMinutes: z.number().int().min(10).max(600),
  goalEntertainmentMinutes: z.number().int().min(10).max(600),
  goalCaloriesPerDay: z.number().int().min(1000).max(5000),
}).partial() // unknown keys are ignored

export type UpdateGoalsInput = z.infer<typeof updateGoalsSchema>

// Weekly check-in — the answers that drive goals, re-asked so goals keep up with the user
export const checkInSchema = onboardingSchema.pick({
  primaryGoal: true,
  currentActivityLevel: true,
  currentSleepHours: true,
  currentScreenHours: true,
  ecoConsciousness: true,
}).extend({
  weightKg: z.number().min(20).max(350).optional(),
})

export type CheckInInput = z.infer<typeof checkInSchema>
