import { z } from 'zod'

export const createPhysicalSchema = z.object({
  steps: z.number().int().nonnegative(),
  distanceKm: z.number().nonnegative(),
  caloriesKcal: z.number().int().nonnegative(),
  sleepMinutes: z.number().int().nonnegative(),
  timestamp: z.string().datetime().optional(),
})

export type CreatePhysicalInput = z.infer<typeof createPhysicalSchema>
