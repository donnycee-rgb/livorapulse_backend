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
