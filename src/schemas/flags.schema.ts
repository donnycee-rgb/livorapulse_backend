import { z } from 'zod'

export const flagIdParamsSchema = z.object({
  id: z.string().min(1).max(64),
})
