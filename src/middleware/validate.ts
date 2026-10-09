import { z, ZodTypeAny } from 'zod'

/**
 * Validate `data` against `schema`.
 * Returns the typed, parsed value on success (after any defaults and
 * transforms in the schema, e.g. "true" → true).
 * Throws a ZodError on failure — caught by the global error handler which
 * formats it as a VALIDATION_ERROR 400 response.
 */
export function validate<S extends ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  return schema.parse(data)
}
