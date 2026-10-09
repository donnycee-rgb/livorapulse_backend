import { z } from 'zod'

const months = z.coerce.number().refine((m) => m === 1 || m === 3, 'Choose 1 or 3 months').transform((m) => m as 1 | 3)

export const summaryQuerySchema = z.object({
  months: months.default(1),
  notes: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
})

export const createShareSchema = z.object({
  months: z.union([z.literal(1), z.literal(3)]),
  includeNotes: z.boolean().default(false),
})

export const shareIdParamsSchema = z.object({
  id: z.string().min(1).max(64),
})

/** Tokens are 32 random bytes in base64url: exactly 43 characters */
export const shareTokenParamsSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Invalid link'),
})
