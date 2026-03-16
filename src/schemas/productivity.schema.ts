import { z } from 'zod'

export const createProductivitySchema = z.object({
  kind: z.enum(['FOCUS', 'STUDY']),
  label: z.string().optional(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  durationSec: z.number().int().positive('Duration must be greater than 0'),
})

export type CreateProductivityInput = z.infer<typeof createProductivitySchema>
