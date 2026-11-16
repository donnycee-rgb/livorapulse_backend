import { z } from 'zod'
import { HABIT_KEYS, TRIP_MODE_KEYS } from '../utils/green'

const when = z.string().datetime().optional()

/** A green habit: done today (at most once a day) */
export const habitSchema = z.object({
  kind: z.literal('habit'),
  habit: z.enum(HABIT_KEYS as [string, ...string[]]),
  timestamp: when,
})

/** A trip: how and roughly how far; the server works out CO₂ */
export const tripSchema = z.object({
  kind: z.literal('trip'),
  mode: z.enum(TRIP_MODE_KEYS as [string, ...string[]]),
  distanceKm: z.number().positive().max(500),
  timestamp: when,
})

export const createEcoSchema = z.discriminatedUnion('kind', [habitSchema, tripSchema])

export type CreateEcoInput = z.infer<typeof createEcoSchema>
