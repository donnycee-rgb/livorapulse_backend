import { z } from 'zod'

/** A town id from the app's list ("kisumu", "nairobi"…), or "other" */
export const townId = z.string().regex(/^[a-z][a-z-]{1,30}$/, 'Unknown town')

export const updateProfileSchema = z.object({
  /** Where the walking journey starts; null clears it */
  homeTown: townId.nullable().optional(),
  name: z.string().min(2, 'Name must be at least 2 characters').optional(),
  avatarUrl: z.string().url('Invalid URL').optional(),
  preferences: z
    .object({
      theme: z.enum(['light', 'dark']).optional(),
      units: z.enum(['metric', 'imperial']).optional(),
      notificationsEnabled: z.boolean().optional(),
      focusMode: z.boolean().optional(),
    })
    .optional(),
})

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>
