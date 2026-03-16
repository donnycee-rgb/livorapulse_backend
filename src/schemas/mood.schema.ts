import { z } from 'zod'

export const createMoodSchema = z.object({
  emoji: z.string().min(1, 'Emoji is required'),
  stressScore: z
    .number()
    .int()
    .min(1, 'Stress score must be at least 1')
    .max(10, 'Stress score must be at most 10'),
  note: z.string().optional(),
})

export type CreateMoodInput = z.infer<typeof createMoodSchema>
