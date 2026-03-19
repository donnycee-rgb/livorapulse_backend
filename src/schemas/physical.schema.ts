import { z } from 'zod'

const coordSchema = z.object({
  lat: z.number(),
  lng: z.number(),
})

export const createPhysicalSchema = z.object({
  steps: z.number().int().nonnegative(),
  distanceKm: z.number().nonnegative(),
  caloriesKcal: z.number().int().nonnegative(),
  sleepMinutes: z.number().int().nonnegative(),
  note: z.string().optional(),
  trail: z.array(coordSchema).optional(),
  timestamp: z.string().datetime().optional(),
})

export type CreatePhysicalInput = z.infer<typeof createPhysicalSchema>