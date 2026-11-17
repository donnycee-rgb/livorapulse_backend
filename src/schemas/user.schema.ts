import { z } from 'zod'

/**
 * Where the walking journey starts: a rough location (the app rounds it to
 * ~1 km; it's used once and not stored), a town from the list, or clear.
 */
export const walkRouteSchema = z.union([
  z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
  z.object({ town: z.string().min(2).max(40) }),
  z.object({ clear: z.literal(true) }),
])

export const updateProfileSchema = z.object({
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
