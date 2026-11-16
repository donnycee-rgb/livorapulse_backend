import { z } from 'zod'
import { clientTime } from './clientTime'

export const logNutritionSchema = z.object({
  mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
  foodName: z.string().min(1),
  calories: z.number().nonnegative(),
  proteinG: z.number().nonnegative().default(0),
  carbsG: z.number().nonnegative().default(0),
  fatG: z.number().nonnegative().default(0),
  quantity: z.number().positive().default(1),
  unit: z.string().default('serving'),
  timestamp: z.string().datetime().optional(),
})

export const logWaterSchema = z.object({
  glasses: z.number().int().positive().default(1),
  /** When it was logged, for glasses saved offline and uploaded later */
  timestamp: clientTime.optional(),
})

export type LogNutritionInput = z.infer<typeof logNutritionSchema>
export type LogWaterInput = z.infer<typeof logWaterSchema>
