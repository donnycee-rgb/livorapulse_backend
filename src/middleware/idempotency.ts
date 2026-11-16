import type { FastifyInstance, FastifyRequest } from 'fastify'
import { redis } from '../db/redis'
import { verifyAccessToken } from '../utils/jwt'

// ─── Saving a log exactly once ──────────────────────────────────────────────
// The app keeps logs made offline on the phone and uploads them when the
// connection is back. If an upload reaches the server but the reply is lost
// (the signal drops again), the app sends it again. Each log carries a random
// Idempotency-Key; a key seen before gets the first answer back instead of
// saving the log twice.

const TTL_SEC = 14 * 24 * 60 * 60 // as long as the app keeps a log waiting
const KEY_FORMAT = /^[A-Za-z0-9_-]{16,64}$/

declare module 'fastify' {
  interface FastifyRequest {
    idempotencyKey?: string
  }
}

/** Redis calls get a short deadline: without Redis the request just goes ahead */
function withTimeout<T>(p: Promise<T>, ms = 500): Promise<T | null> {
  return Promise.race([p.catch(() => null), new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))])
}

/** Per account, so one person's key can never return another person's answer */
export function storageKey(request: FastifyRequest): string | null {
  if (request.method !== 'POST') return null
  const key = request.headers['idempotency-key']
  if (typeof key !== 'string' || !KEY_FORMAT.test(key)) return null
  const auth = request.headers.authorization
  if (!auth?.startsWith('Bearer ')) return null
  try {
    const { id } = verifyAccessToken(auth.slice(7))
    return `idem:${id}:${key}`
  } catch {
    return null // the route's own check answers 401
  }
}

export function registerIdempotency(app: FastifyInstance): void {
  app.addHook('preHandler', async (request, reply) => {
    const key = storageKey(request)
    if (!key) return
    const saved = await withTimeout(redis.get(key))
    if (saved) {
      const { status, body } = JSON.parse(saved) as { status: number; body: string }
      return reply.status(status).header('content-type', 'application/json; charset=utf-8').header('idempotent-replay', 'true').send(body)
    }
    request.idempotencyKey = key
  })

  app.addHook('onSend', async (request, reply, payload) => {
    const key = request.idempotencyKey
    if (key && reply.statusCode >= 200 && reply.statusCode < 300 && typeof payload === 'string') {
      await withTimeout(redis.set(key, JSON.stringify({ status: reply.statusCode, body: payload }), 'EX', TTL_SEC))
    }
    return payload
  })
}
