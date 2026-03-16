import { FastifyReply, FastifyRequest } from 'fastify'
import { verifyAccessToken } from '../utils/jwt'

/**
 * Fastify preHandler hook — verifies the Bearer access token.
 * On success, attaches { id, email } to request.user (via PassportUser augmentation).
 * Replies 401 immediately if the token is missing or invalid.
 */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    void reply.status(401).send({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Unauthorized' },
    })
    return
  }

  const token = authHeader.slice(7)
  try {
    const decoded = verifyAccessToken(token)
    request.user = { id: decoded.id, email: decoded.email }
  } catch {
    void reply.status(401).send({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Unauthorized' },
    })
  }
}
