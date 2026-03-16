import { z } from 'zod'

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
