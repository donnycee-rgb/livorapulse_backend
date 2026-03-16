import { z } from 'zod'

export const createEcoSchema = z.object({
  category: z.enum(['TRANSPORT', 'FOOD', 'ENERGY', 'WASTE']),
  type: z.string().min(1, 'Type is required'),
  impactKgCO2: z.number(),
  timestamp: z.string().datetime().optional(),
})

export type CreateEcoInput = z.infer<typeof createEcoSchema>
