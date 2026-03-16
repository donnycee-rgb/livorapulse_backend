import { z } from 'zod'

export const createDigitalSchema = z.object({
  screenTimeMinutes: z.number().int().nonnegative(),
  categoryBreakdown: z.record(z.string(), z.number().nonnegative()),
  date: z.string().datetime().optional(),
})

export type CreateDigitalInput = z.infer<typeof createDigitalSchema>
