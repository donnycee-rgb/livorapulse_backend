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
  /** Sleep with times: when the person went to sleep and woke up. The server works out the minutes. */
  sleepStart: z.string().datetime().optional(),
  sleepEnd: z.string().datetime().optional(),
})
  .refine((b) => !b.activityType || b.durationMin, { message: 'Say how long the activity lasted' })
  .refine((b) => !b.sleepStart === !b.sleepEnd, { message: 'Give both the time you went to sleep and the time you woke up' })
  .refine((b) => !b.sleepStart || !b.sleepEnd || sleepSpanOk(b.sleepStart, b.sleepEnd), {
    message: "Sleep must last between 10 minutes and 20 hours, and can't end in the future",
  })

/** Between 10 minutes and 20 hours, and not ending in the future (10 minutes of slack for phone clocks) */
export function sleepSpanOk(start: string, end: string, now = Date.now()): boolean {
  const s = Date.parse(start), e = Date.parse(end)
  const minutes = (e - s) / 60000
  return minutes >= 10 && minutes <= 20 * 60 && e <= now + 10 * 60000
}

export type CreatePhysicalInput = z.infer<typeof createPhysicalSchema>