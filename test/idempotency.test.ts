import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => new Map<string, string>())
vi.mock('../src/db/redis', () => ({
  redis: {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => { store.set(k, v); return 'OK' },
  },
}))

import { registerIdempotency } from '../src/middleware/idempotency'
import { signAccessToken } from '../src/utils/jwt'
import { clientTime } from '../src/schemas/clientTime'

function buildApp() {
  const app = Fastify()
  registerIdempotency(app)
  let saved = 0
  app.post('/log', async (_req, reply) => {
    saved += 1
    return reply.status(201).send({ success: true, data: { n: saved } })
  })
  return { app, count: () => saved }
}

const KEY = 'a1b2c3d4e5f6g7h8i9j0'
const auth = (id: string) => ({ authorization: `Bearer ${signAccessToken({ id, email: `${id}@example.test` })}` })

beforeEach(() => {
  vi.stubEnv('JWT_ACCESS_SECRET', 'test-access-secret')
  store.clear()
})

describe('uploading a log twice', () => {
  it('saves it once and answers the retry with the first reply', async () => {
    const { app, count } = buildApp()
    const first = await app.inject({ method: 'POST', url: '/log', headers: { ...auth('u1'), 'idempotency-key': KEY }, payload: {} })
    const again = await app.inject({ method: 'POST', url: '/log', headers: { ...auth('u1'), 'idempotency-key': KEY }, payload: {} })
    expect(count()).toBe(1)
    expect(again.statusCode).toBe(201)
    expect(again.json()).toEqual(first.json())
    expect(again.headers['idempotent-replay']).toBe('true')
  })

  it("keeps each account's keys apart", async () => {
    const { app, count } = buildApp()
    await app.inject({ method: 'POST', url: '/log', headers: { ...auth('u1'), 'idempotency-key': KEY }, payload: {} })
    await app.inject({ method: 'POST', url: '/log', headers: { ...auth('u2'), 'idempotency-key': KEY }, payload: {} })
    expect(count()).toBe(2)
  })

  it('without a key, every request is saved', async () => {
    const { app, count } = buildApp()
    await app.inject({ method: 'POST', url: '/log', headers: auth('u1'), payload: {} })
    await app.inject({ method: 'POST', url: '/log', headers: auth('u1'), payload: {} })
    expect(count()).toBe(2)
  })
})

describe('time a log was made', () => {
  it('accepts recent times and rejects the future or long ago', () => {
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString()
    expect(clientTime.safeParse(hoursAgo(50)).success).toBe(true)
    expect(clientTime.safeParse(hoursAgo(-1)).success).toBe(false)
    expect(clientTime.safeParse(hoursAgo(24 * 15)).success).toBe(false)
  })
})
