import { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import { ZodError } from 'zod'
import { AppError } from '../utils/response'

/**
 * Global Fastify error handler.
 * All errors thrown inside route handlers (or from validate()) end up here.
 *
 * Response shape for every error:
 * { success: false, error: { code, message, details? } }
 */
export function errorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  // ── Zod validation errors ────────────────────────────────────────────────
  if (error instanceof ZodError) {
    void reply.status(400).send({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: error.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      },
    })
    return
  }

  // ── Custom application errors ─────────────────────────────────────────────
  if (error instanceof AppError) {
    void reply.status(error.statusCode).send({
      success: false,
      error: { code: error.code, message: error.message },
    })
    return
  }

  // ── Fastify built-in errors (404, 405, etc.) ──────────────────────────────
  const statusCode = 'statusCode' in error ? (error as FastifyError).statusCode : undefined
  if (statusCode && statusCode >= 400 && statusCode < 500) {
    void reply.status(statusCode).send({
      success: false,
      error: { code: 'REQUEST_ERROR', message: error.message },
    })
    return
  }

  // ── Unhandled / internal errors ───────────────────────────────────────────
  request.log.error(error)
  void reply.status(500).send({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'An internal server error occurred' },
  })
}
