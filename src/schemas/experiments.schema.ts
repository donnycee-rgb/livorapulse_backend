import { z } from 'zod'

export const experimentIdParamsSchema = z.object({
  id: z.string().min(1).max(64),
})

export const startExperimentSchema = z.object({
  insightId: z.string().min(1).max(64),
  /** The user's own wording for the change; the suggestion is used if left out */
  change: z.string().trim().min(3).max(140).optional(),
})

export const experimentCheckinSchema = z.object({
  did: z.boolean(),
  day: z.enum(['today', 'yesterday']).default('today'),
})
