import { beforeEach, describe, expect, it, vi } from 'vitest'
import { forgotPassword, resetPassword, sendVerificationCode, verifyEmailCode } from '../src/services/AuthService'
import { resetPasswordSchema, verifyEmailSchema } from '../src/schemas/auth.schema'
import { comparePassword } from '../src/utils/hash'

// In-memory Redis, users and refresh tokens; emails are captured, not sent
const s = vi.hoisted(() => ({
  redis: new Map<string, { v: string; exp: number }>(),
  users: new Map<string, { id: string; name: string; email: string; passwordHash: string | null; emailVerifiedAt: Date | null }>(),
  tokens: [] as { userId: string; revoked: boolean }[],
  sent: [] as { kind: string; params: Record<string, unknown> }[],
}))

vi.mock('../src/db/redis', () => {
  const live = (k: string) => {
    const e = s.redis.get(k)
    if (e && e.exp < Date.now()) { s.redis.delete(k); return undefined }
    return e
  }
  return {
    redis: {
      set: async (k: string, v: string, ...opts: (string | number)[]) => {
        if (opts.includes('NX') && live(k)) return null
        const ex = opts[0] === 'EX' ? Number(opts[1]) : 3600
        s.redis.set(k, { v, exp: Date.now() + ex * 1000 })
        return 'OK'
      },
      get: async (k: string) => live(k)?.v ?? null,
      getdel: async (k: string) => { const v = live(k)?.v ?? null; s.redis.delete(k); return v },
      del: async (k: string) => { s.redis.delete(k); return 1 },
      incr: async (k: string) => { const n = Number(live(k)?.v ?? 0) + 1; s.redis.set(k, { v: String(n), exp: live(k)?.exp ?? Date.now() + 3600_000 }); return n },
      expire: async () => 1,
      ttl: async (k: string) => { const e = live(k); return e ? Math.ceil((e.exp - Date.now()) / 1000) : -2 },
    },
  }
})

vi.mock('../src/db/prisma', () => ({
  prisma: {
    user: {
      findUnique: async ({ where }: { where: { id?: string; email?: string } }) =>
        [...s.users.values()].find((u) => (where.id ? u.id === where.id : u.email === where.email)) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(s.users.get(where.id)!, data),
    },
    refreshToken: {
      updateMany: async ({ where }: { where: { userId: string } }) => {
        s.tokens.filter((t) => t.userId === where.userId).forEach((t) => { t.revoked = true })
        return { count: 1 }
      },
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  },
}))

vi.mock('../src/services/EmailService', () => ({
  sendEmail: async (kind: string, params: Record<string, unknown>) => { s.sent.push({ kind, params }) },
}))

beforeEach(() => {
  s.redis.clear()
  s.users.clear()
  s.tokens.length = 0
  s.sent.length = 0
  s.users.set('u1', { id: 'u1', name: 'Amina', email: 'amina@example.test', passwordHash: 'old-hash', emailVerifiedAt: null })
  s.tokens.push({ userId: 'u1', revoked: false }, { userId: 'u1', revoked: false })
})

const lastCode = () => String(s.sent.filter((m) => m.kind === 'verify').at(-1)!.params.code)
const lastLinkToken = () => new URL(String(s.sent.filter((m) => m.kind === 'reset').at(-1)!.params.reset_link)).searchParams.get('token')!

describe('sign-up code', () => {
  it('emails a 6-digit code that confirms the email', async () => {
    await sendVerificationCode('u1')
    const code = lastCode()
    expect(code).toMatch(/^\d{6}$/)
    expect(s.sent[0].params).toMatchObject({ to_email: 'amina@example.test', to_name: 'Amina', expires_minutes: 15 })
    await verifyEmailCode('u1', code)
    expect(s.users.get('u1')!.emailVerifiedAt).toBeInstanceOf(Date)
  })

  it('keeps only a hash of the code', async () => {
    await sendVerificationCode('u1')
    const stored = [...s.redis.entries()].find(([k]) => k === 'email_verify:u1')![1].v
    expect(stored).not.toContain(lastCode())
  })

  it('works once', async () => {
    await sendVerificationCode('u1')
    const code = lastCode()
    await verifyEmailCode('u1', code)
    await expect(verifyEmailCode('u1', code)).rejects.toMatchObject({ code: 'CODE_EXPIRED' })
  })

  it('rejects a wrong code, and voids the code after 5 wrong tries', async () => {
    await sendVerificationCode('u1')
    const right = lastCode()
    const wrong = right === '000000' ? '111111' : '000000'
    for (let i = 0; i < 4; i++) await expect(verifyEmailCode('u1', wrong)).rejects.toMatchObject({ code: 'WRONG_CODE' })
    await expect(verifyEmailCode('u1', wrong)).rejects.toMatchObject({ code: 'TOO_MANY_TRIES' })
    // Even the right code no longer works: a new one is needed
    await expect(verifyEmailCode('u1', right)).rejects.toMatchObject({ code: 'CODE_EXPIRED' })
    expect(s.users.get('u1')!.emailVerifiedAt).toBeNull()
  })

  it('allows one new code a minute', async () => {
    await sendVerificationCode('u1')
    await expect(sendVerificationCode('u1')).rejects.toMatchObject({ statusCode: 429 })
    expect(s.sent).toHaveLength(1)
  })

  it('refuses when the email is already confirmed', async () => {
    s.users.get('u1')!.emailVerifiedAt = new Date()
    await expect(sendVerificationCode('u1')).rejects.toMatchObject({ statusCode: 409 })
  })

  it('accepts only 6 digits', () => {
    expect(verifyEmailSchema.safeParse({ code: ' 123456 ' }).success).toBe(true)
    expect(verifyEmailSchema.safeParse({ code: '12345' }).success).toBe(false)
    expect(verifyEmailSchema.safeParse({ code: 'abcdef' }).success).toBe(false)
  })
})

describe('password reset', () => {
  it('emails a link that sets a new password once', async () => {
    await forgotPassword('amina@example.test')
    const token = lastLinkToken()
    expect(s.sent[0].params.reset_link).toMatch(/\/reset-password\?token=[A-Za-z0-9_-]{43}$/)
    expect(resetPasswordSchema.safeParse({ token, password: 'new-password-1' }).success).toBe(true)

    await resetPassword(token, 'new-password-1')
    expect(await comparePassword('new-password-1', s.users.get('u1')!.passwordHash!)).toBe(true)
    await expect(resetPassword(token, 'another-one-2')).rejects.toMatchObject({ code: 'LINK_EXPIRED' })
  })

  it('signs out every other session and confirms the email', async () => {
    await forgotPassword('amina@example.test')
    await resetPassword(lastLinkToken(), 'new-password-1')
    expect(s.tokens.every((t) => t.revoked)).toBe(true)
    expect(s.users.get('u1')!.emailVerifiedAt).toBeInstanceOf(Date)
  })

  it('says nothing about whether an email has an account', async () => {
    await expect(forgotPassword('nobody@example.test')).resolves.toBeUndefined()
    expect(s.sent).toHaveLength(0)
  })

  it('makes an earlier link stop working when a new one is sent', async () => {
    await forgotPassword('amina@example.test')
    const first = lastLinkToken()
    s.redis.delete('pw_reset_cooldown:u1') // a minute later
    await forgotPassword('amina@example.test')
    await expect(resetPassword(first, 'new-password-1')).rejects.toMatchObject({ code: 'LINK_EXPIRED' })
    await expect(resetPassword(lastLinkToken(), 'new-password-1')).resolves.toBeUndefined()
  })

  it('sends at most one email a minute per account', async () => {
    await forgotPassword('amina@example.test')
    await forgotPassword('amina@example.test')
    expect(s.sent).toHaveLength(1)
  })

  it('keeps only a hash of the link', async () => {
    await forgotPassword('amina@example.test')
    const token = lastLinkToken()
    expect([...s.redis.keys()].some((k) => k.includes(token))).toBe(false)
    expect([...s.redis.values()].some((e) => e.v.includes(token))).toBe(false)
  })

  it('rejects links that are not tokens, and short passwords', () => {
    expect(resetPasswordSchema.safeParse({ token: 'abc', password: 'long-enough' }).success).toBe(false)
    expect(resetPasswordSchema.safeParse({ token: 'a'.repeat(43), password: 'short' }).success).toBe(false)
  })
})
