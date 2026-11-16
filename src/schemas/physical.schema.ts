import { z } from 'zod'
import { ACTIVITY_TYPES } from '../utils/activities'

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
  /** Sleep only: 'night' sets or corrects last night (one per day), 'nap' adds */
  sleepType: z.enum(['night', 'nap']).optional(),
  /** Another activity: what it was and for how long; the server works out calories */
  activityType: z.enum(ACTIVITY_TYPES as [string, ...string[]]).optional(),
  durationMin: z.number().int().min(1).max(600).optional(),
}).refine((b) => !b.activityType || b.durationMin, { message: 'Say how long the activity lasted' })

export type CreatePhysicalInput = z.infer<typeof createPhysicalSchema>