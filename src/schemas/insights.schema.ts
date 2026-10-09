import { z } from 'zod'

export const insightIdParamsSchema = z.object({
  id: z.string().min(1).max(64),
})

export const insightFeedbackSchema = z.object({
  feedback: z.enum(['useful', 'not-true']),
})

export type InsightFeedbackInput = z.infer<typeof insightFeedbackSchema>
