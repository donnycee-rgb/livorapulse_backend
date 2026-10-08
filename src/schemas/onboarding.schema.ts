import { z } from 'zod'

// Setup after sign-up. Only the main goal is required — every other answer
// can be skipped and falls back to standard targets.
export const onboardingSchema = z.object({
  dateOfBirth: z.string().datetime().optional(),
  gender: z.enum(['male', 'female', 'non-binary', 'prefer-not-to-say']).optional(),
  heightCm: z.number().positive().optional(),
  weightKg: z.number().positive().optional(),
  hasDisability: z.boolean().default(false),
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
  // Used to calculate goals — not stored directly. Defaults are typical values.
  currentSleepHours: z.number().min(0).max(24).default(7.5),
  currentActivityLevel: z.enum(['sedentary', 'light', 'moderate', 'active', 'very-active']).default('light'),
  currentScreenHours: z.number().min(0).max(24).default(4),
  // No longer asked during setup (mood is logged daily on the Mood page); accepted for older clients
  currentMood: z.enum(['thriving', 'balanced', 'struggling', 'overwhelmed', 'exhausted']).optional(),
  currentStress: z.enum(['very-calm', 'mild', 'moderate', 'high', 'burned-out']).optional(),
  ecoConsciousness: z.enum(['rarely', 'sometimes', 'often', 'always']).default('sometimes'),
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
