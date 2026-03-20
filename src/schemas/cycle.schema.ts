import { z } from 'zod'

export const logCycleSchema = z.object({
  periodStartDate: z.string().datetime(),
  cycleLength: z.number().int().min(21).max(45).default(28),
  periodDuration: z.number().int().min(1).max(10).default(5),
  flowIntensity: z.enum(['spotting', 'light', 'medium', 'heavy']).optional(),
  symptoms: z.array(z.string()).optional(),
  notes: z.string().optional(),
})

export const updateCycleSettingsSchema = z.object({
  cycleLength: z.number().int().min(21).max(45),
  periodDuration: z.number().int().min(1).max(10),
})

export type LogCycleInput = z.infer<typeof logCycleSchema>
export type UpdateCycleSettingsInput = z.infer<typeof updateCycleSettingsSchema>
