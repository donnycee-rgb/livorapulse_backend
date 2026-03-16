import { z } from 'zod'

export const dailyScoreQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
    .optional(),
})

export type DailyScoreQuery = z.infer<typeof dailyScoreQuerySchema>
