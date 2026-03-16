import { ZodSchema } from 'zod'

/**
 * Validate `data` against `schema`.
 * Returns the typed, parsed value on success.
 * Throws a ZodError on failure — caught by the global error handler which
 * formats it as a VALIDATION_ERROR 400 response.
 */
export function validate<T>(schema: ZodSchema<T>, data: unknown): T {
  return schema.parse(data)
}
