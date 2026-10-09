import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLoginCode, exchangeLoginCode, refresh } from '../src/services/AuthService'
import { exchangeCodeSchema } from '../src/schemas/auth.schema'
import { verifyAccessToken } from '../src/utils/jwt'

// In-memory stand-ins for Redis and the refresh-token table; vi.mock is hoisted
const store = vi.hoisted(() => ({
  redis: new Map<string, string>(),
  tokens: [] as { id: string; token: string; userId: string; expiresAt: Date; revoked: boolean }[],
}))

vi.mock('../src/db/redis', () => ({
  redis: {
    set: async (k: string, v: string) => { store.redis.set(k, v); return 'OK' },
    getdel: async (k: string) => { const v = store.redis.get(k) ?? null; store.redis.delete(k); return v },
  },
}))

vi.mock('../src/db/prisma', () => ({
  prisma: {
    refreshToken: {
      create: async ({ data }: { data: { token: string; userId: string; expiresAt: Date } }) => {
        const row = { id: `rt${store.tokens.length + 1}`, revoked: false, ...data }
        store.tokens.push(row)
        return row
      },
      findUnique: async ({ where }: { where: { token: string } }) => store.tokens.find((t) => t.token === where.token) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: { revoked: boolean } }) => {
        const row = store.tokens.find((t) => t.id === where.id)!
        Object.assign(row, data)
        return row
      },
    },
  },
}))

beforeEach(() => {
  vi.stubEnv('JWT_ACCESS_SECRET', 'test-access-secret')
  vi.stubEnv('JWT_REFRESH_SECRET', 'test-refresh-secret')
  store.redis.clear()
  store.tokens.length = 0
})

describe('Google sign-in one-time code', () => {
  it('is URL-safe and passes validation', async () => {
    const code = await createLoginCode('u1', 'a@example.test')
    expect(exchangeCodeSchema.safeParse({ code }).success).toBe(true)
  })

  it('swaps for a working token pair, once', async () => {
    const code = await createLoginCode('u1', 'a@example.test')
    const tokens = await exchangeLoginCode(code)
    expect(verifyAccessToken(tokens.accessToken)).toMatchObject({ id: 'u1', email: 'a@example.test' })
    expect(store.tokens).toHaveLength(1) // the refresh token is stored, so it can be renewed later
    await expect(exchangeLoginCode(code)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('rejects unknown codes', async () => {
    await expect(exchangeLoginCode('x'.repeat(43))).rejects.toMatchObject({ statusCode: 401 })
  })

  it('keeps no tokens in Redis, only who signed in', async () => {
    await createLoginCode('u1', 'a@example.test')
    const [value] = [...store.redis.values()]
    expect(JSON.parse(value)).toEqual({ userId: 'u1', email: 'a@example.test' })
  })
})

describe('refresh', () => {
  it('replaces the refresh token, and the old one stops working', async () => {
    const code = await createLoginCode('u1', 'a@example.test')
    const first = await exchangeLoginCode(code)
    const second = await refresh(first.refreshToken)
    expect(verifyAccessToken(second.accessToken).id).toBe('u1')
    await expect(refresh(first.refreshToken)).rejects.toMatchObject({ statusCode: 401 })
  })
})
