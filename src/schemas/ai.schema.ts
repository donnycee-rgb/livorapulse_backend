import { z } from 'zod'

// Only the last 10 messages are sent to the model, but the app sends the
// whole conversation, so allow a longer history than that.
export const aiChatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1, 'Message is empty').max(4000, 'Message is too long'),
      }),
    )
    .min(1, 'No messages provided')
    .max(100, 'Conversation is too long'),
})

export type AiChatInput = z.infer<typeof aiChatSchema>
