import { z } from 'zod'

// A check-in records whichever answers the user actually gave. Sending only
// one keeps the other null instead of filling it with a stale default.
export const createMoodSchema = z
  .object({
    emoji: z.string().min(1, 'Emoji is required').optional(),
    stressScore: z
      .number()
      .int()
      .min(1, 'Stress score must be at least 1')
      .max(10, 'Stress score must be at most 10')
      .optional(),
    note: z.string().optional(),
  })
  .refine((b) => b.emoji !== undefined || b.stressScore !== undefined, {
    message: 'Send a mood, a stress score, or both',
  })

export type CreateMoodInput = z.infer<typeof createMoodSchema>
