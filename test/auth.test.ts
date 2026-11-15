import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLoginCode, exchangeLoginCode, hashToken, logout, refresh } from '../src/services/AuthService'
import { sessionSecret } from '../src/App'
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
    get: async (k: string) => store.redis.get(k) ?? null,
    multi: () => {
      const ops: (() => unknown)[] = []
      const chain = {
        get: (k: string) => { ops.push(() => store.redis.get(k) ?? null); return chain },
        del: (k: string) => { ops.push(() => { store.redis.delete(k); return 1 }); return chain },
        exec: async () => ops.map((op) => [null, op()]),
      }
      return chain
    },
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
      findFirst: async ({ where }: { where: { token: { in: string[] } } }) =>
        store.tokens.find((t) => where.token.in.includes(t.token)) ?? null,
      updateMany: async ({ where, data }: {
        where: { id?: string; userId?: string; revoked?: boolean; token?: { in: string[] } }
        data: { revoked: boolean }
      }) => {
        const rows = store.tokens.filter((t) =>
          (where.id === undefined || t.id === where.id) &&
          (where.userId === undefined || t.userId === where.userId) &&
          (where.revoked === undefined || t.revoked === where.revoked) &&
          (where.token === undefined || where.token.in.includes(t.token)))
        rows.forEach((r) => Object.assign(r, data))
        return { count: rows.length }
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

describe('refresh token storage and reuse', () => {
  const signIn = async () => exchangeLoginCode(await createLoginCode('u1', 'a@example.test'))
  const live = () => store.tokens.filter((t) => !t.revoked).length

  it('stores only a hash of the token', async () => {
    const { refreshToken } = await signIn()
    expect(store.tokens[0].token).toBe(hashToken(refreshToken))
    expect(store.tokens[0].token).not.toBe(refreshToken)
  })

  it('still renews a token saved before hashing', async () => {
    const { refreshToken } = await signIn()
    store.tokens[0].token = refreshToken // as an older row would hold it
    const next = await refresh(refreshToken)
    expect(verifyAccessToken(next.accessToken).id).toBe('u1')
  })

  it('a replaced token used again later signs the account out everywhere', async () => {
    const first = await signIn()
    await refresh(first.refreshToken)
    const other = await signIn() // e.g. another device
    // pretend the replacement happened two minutes ago
    store.redis.set(`rt:replaced:${hashToken(first.refreshToken)}`, String(Date.now() - 120_000))
    expect(live()).toBe(2)
    await expect(refresh(first.refreshToken)).rejects.toMatchObject({ statusCode: 401 })
    expect(live()).toBe(0)
    await expect(refresh(other.refreshToken)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('two tabs renewing at once: the second is turned away, nobody is signed out', async () => {
    const first = await signIn()
    await refresh(first.refreshToken)
    await expect(refresh(first.refreshToken)).rejects.toMatchObject({ statusCode: 401 })
    expect(live()).toBe(1)
  })

  it('a signed-out token is turned away without signing anyone else out', async () => {
    const first = await signIn()
    const other = await signIn()
    await logout(first.refreshToken)
    await expect(refresh(first.refreshToken)).rejects.toMatchObject({ statusCode: 401 })
    expect(verifyAccessToken((await refresh(other.refreshToken)).accessToken).id).toBe('u1')
  })

  it('rejects a forged token before looking it up', async () => {
    await expect(refresh('not-a-jwt')).rejects.toMatchObject({ statusCode: 401 })
  })
})

describe('session secret', () => {
  it('is required in production', () => {
    expect(() => sessionSecret({ NODE_ENV: 'production' })).toThrow(/SESSION_SECRET/)
    expect(() => sessionSecret({ NODE_ENV: 'production', SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/)
  })

  it('uses the configured secret, or a local one in development', () => {
    const real = 'x'.repeat(40)
    expect(sessionSecret({ NODE_ENV: 'production', SESSION_SECRET: real })).toBe(real)
    expect(sessionSecret({ NODE_ENV: 'development' })).toMatch(/local-development/)
  })
})
