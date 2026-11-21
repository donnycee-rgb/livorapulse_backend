import { z } from 'zod'

const dayKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')

/** An older app version's "log a period start" */
export const logCycleSchema = z.object({
  periodStartDate: z.string().datetime(),
  cycleLength: z.number().int().min(21).max(45).default(28),
  periodDuration: z.number().int().min(1).max(10).default(5),
  flowIntensity: z.enum(['spotting', 'light', 'medium', 'heavy']).optional(),
  symptoms: z.array(z.string()).optional(),
  notes: z.string().optional(),
})

/** One period day: set it (or update it) */
export const periodDaySchema = z.object({
  date: dayKeySchema,
  flow: z.enum(['spotting', 'light', 'medium', 'heavy']).nullable().optional(),
  symptoms: z.array(z.string().max(40)).max(20).optional(),
  notes: z.string().max(500).nullable().optional(),
})

export const removeDaySchema = z.object({ date: dayKeySchema })

/** "My period ended": its last day, or ended: false to take that back */
export const periodEndedSchema = z.union([
  z.object({ lastDay: dayKeySchema }),
  z.object({ ended: z.literal(false) }),
])

export const daysQuerySchema = z.object({ from: dayKeySchema, to: dayKeySchema })

export const updateCycleSettingsSchema = z.object({
  cycleLength: z.number().int().min(21).max(45),
  periodDuration: z.number().int().min(1).max(10),
  /** Show the cycle tracker at all */
  tracking: z.boolean(),
})

export type LogCycleInput = z.infer<typeof logCycleSchema>
export type UpdateCycleSettingsInput = z.infer<typeof updateCycleSettingsSchema>
