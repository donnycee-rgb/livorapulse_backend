import crypto from 'crypto'
import { prisma } from '../db/prisma'
import { redis } from '../db/redis'
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  parseDurationToDate,
} from '../utils/jwt'
import { hashPassword, comparePassword } from '../utils/hash'
import { AppError } from '../utils/response'
import { sendEmail } from './EmailService'
import type { RegisterInput, LoginInput } from '../schemas/auth.schema'

export interface AuthUser {
  id: string
  name: string
  email: string
  emailVerifiedAt: Date | null
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
}

export interface AuthResult extends TokenPair {
  user: AuthUser
  /** After sign-up: whether the verification code email went out */
  verificationSent?: boolean
}

async function issueTokens(userId: string, email: string): Promise<TokenPair> {
  const accessToken = signAccessToken({ id: userId, email })
  const refreshToken = signRefreshToken({ id: userId, email })
  const expiresAt = parseDurationToDate(process.env.JWT_REFRESH_EXPIRES_IN ?? '30d')
  await prisma.refreshToken.create({
    data: { token: refreshToken, userId, expiresAt },
  })
  return { accessToken, refreshToken }
}

// ─── Google sign-in hand-off ─────────────────────────────────────────────────
// After Google sign-in the browser is redirected to the app. Putting tokens in
// that URL would leave them in browser history and server logs, so the URL
// carries a one-time code instead, which the app swaps for tokens straight away.

const LOGIN_CODE_TTL_SEC = 60
const loginCodeKey = (code: string) => `login_code:${code}`

/** A single-use code, valid for 60 seconds, that the app exchanges for tokens */
export async function createLoginCode(userId: string, email: string): Promise<string> {
  const code = crypto.randomBytes(32).toString('base64url')
  await redis.set(loginCodeKey(code), JSON.stringify({ userId, email }), 'EX', LOGIN_CODE_TTL_SEC)
  return code
}

export async function exchangeLoginCode(code: string): Promise<TokenPair> {
  // GETDEL: the code works once, even if two requests race
  const raw = await redis.getdel(loginCodeKey(code))
  if (!raw) throw new AppError('UNAUTHORIZED', 'This sign-in link has expired. Please sign in again.', 401)
  const { userId, email } = JSON.parse(raw) as { userId: string; email: string }
  return issueTokens(userId, email)
}

export async function register(input: RegisterInput): Promise<AuthResult> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } })
  if (existing) throw new AppError('CONFLICT', 'Email is already in use', 409)

  const passwordHash = await hashPassword(input.password)

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash,
        preferences: { create: {} },
      },
      select: { id: true, name: true, email: true, emailVerifiedAt: true },
    })
    return created
  })

  const tokens = await issueTokens(user.id, user.email)
  // The account exists either way; if the email fails, the app offers "send again"
  const verificationSent = await sendVerificationCode(user.id).then(() => true, () => false)
  return { user, ...tokens, verificationSent }
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, name: true, email: true, passwordHash: true, emailVerifiedAt: true },
  })

  if (!user || !user.passwordHash)
    throw new AppError('UNAUTHORIZED', 'Invalid email or password', 401)

  const valid = await comparePassword(input.password, user.passwordHash)
  if (!valid) throw new AppError('UNAUTHORIZED', 'Invalid email or password', 401)

  await prisma.refreshToken.updateMany({
    where: { userId: user.id, revoked: false },
    data: { revoked: true },
  })

  const tokens = await issueTokens(user.id, user.email)
  return { user: { id: user.id, name: user.name, email: user.email, emailVerifiedAt: user.emailVerifiedAt }, ...tokens }
}

export async function logout(refreshToken: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { token: refreshToken },
    data: { revoked: true },
  })
}

export async function refresh(refreshToken: string): Promise<TokenPair> {
  const stored = await prisma.refreshToken.findUnique({ where: { token: refreshToken } })

  if (!stored || stored.revoked)
    throw new AppError('UNAUTHORIZED', 'Invalid refresh token', 401)
  if (stored.expiresAt < new Date())
    throw new AppError('UNAUTHORIZED', 'Refresh token expired', 401)

  let payload: { id: string; email: string }
  try {
    payload = verifyRefreshToken(refreshToken)
  } catch {
    throw new AppError('UNAUTHORIZED', 'Invalid refresh token', 401)
  }

  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revoked: true },
  })

  return issueTokens(payload.id, payload.email)
}

// ─── Email verification (sign-up code) ──────────────────────────────────────
// A 6-digit code, valid 15 minutes. Only a hash is kept. Five wrong tries use
// it up; new codes are limited to one a minute and five an hour.

const CODE_TTL_SEC = 15 * 60
const CODE_MAX_ATTEMPTS = 5
const CODE_COOLDOWN_SEC = 60
const CODE_MAX_PER_HOUR = 5

const verifyKey = (userId: string) => `email_verify:${userId}`
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex')
const codeHash = (userId: string, code: string) => sha256(`${userId}:${code}`)

/** Sends a new sign-up code, replacing any earlier one */
export async function sendVerificationCode(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true, emailVerifiedAt: true } })
  if (!user) throw new AppError('NOT_FOUND', 'User not found', 404)
  if (user.emailVerifiedAt) throw new AppError('ALREADY_VERIFIED', 'Your email is already confirmed', 409)

  // SET NX: only one code a minute, even if two requests race
  const fresh = await redis.set(`email_verify_cooldown:${userId}`, '1', 'EX', CODE_COOLDOWN_SEC, 'NX')
  if (fresh !== 'OK') throw new AppError('TOO_SOON', 'Please wait a minute before asking for another code', 429)
  const hourKey = `email_verify_hour:${userId}`
  const sentThisHour = await redis.incr(hourKey)
  if (sentThisHour === 1) await redis.expire(hourKey, 3600)
  if (sentThisHour > CODE_MAX_PER_HOUR) throw new AppError('TOO_MANY', "You've asked for a lot of codes. Please try again in an hour", 429)

  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0')
  await redis.set(verifyKey(userId), JSON.stringify({ hash: codeHash(userId, code), attempts: 0 }), 'EX', CODE_TTL_SEC)
  await sendEmail('verify', { to_email: user.email, to_name: user.name, code, expires_minutes: CODE_TTL_SEC / 60 })
}

/** Checks the code the user typed; on success their email counts as confirmed */
export async function verifyEmailCode(userId: string, code: string): Promise<void> {
  const raw = await redis.get(verifyKey(userId))
  if (!raw) throw new AppError('CODE_EXPIRED', 'That code has expired. Ask for a new one', 400)
  const stored = JSON.parse(raw) as { hash: string; attempts: number }

  const given = Buffer.from(codeHash(userId, code))
  const expected = Buffer.from(stored.hash)
  if (!crypto.timingSafeEqual(given, expected)) {
    const attempts = stored.attempts + 1
    if (attempts >= CODE_MAX_ATTEMPTS) {
      await redis.del(verifyKey(userId))
      throw new AppError('TOO_MANY_TRIES', 'Too many wrong tries. Ask for a new code', 400)
    }
    // Keep the original expiry (portable alternative to SET … KEEPTTL)
    const ttl = await redis.ttl(verifyKey(userId))
    await redis.set(verifyKey(userId), JSON.stringify({ ...stored, attempts }), 'EX', Math.max(1, ttl))
    throw new AppError('WRONG_CODE', "That code isn't right. Check the email and try again", 400)
  }

  await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } })
  await redis.del(verifyKey(userId))
}

// ─── Password reset (emailed link) ──────────────────────────────────────────
// A single-use link, valid 1 hour. Only a hash of its token is kept. Asking
// for a reset says the same thing whether or not the email has an account.

const RESET_TTL_SEC = 60 * 60
const resetKey = (tokenHash: string) => `pw_reset:${tokenHash}`
const resetUserKey = (userId: string) => `pw_reset_user:${userId}`

export async function forgotPassword(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true, email: true } })
  if (!user) return // same response as a real account, so emails can't be probed

  // One email a minute per account, so the form can't be used to flood someone's inbox
  const fresh = await redis.set(`pw_reset_cooldown:${user.id}`, '1', 'EX', 60, 'NX')
  if (fresh !== 'OK') return

  // A new link replaces any earlier one
  const previous = await redis.get(resetUserKey(user.id))
  if (previous) await redis.del(resetKey(previous))

  const token = crypto.randomBytes(32).toString('base64url')
  const tokenHash = sha256(token)
  await redis.set(resetKey(tokenHash), user.id, 'EX', RESET_TTL_SEC)
  await redis.set(resetUserKey(user.id), tokenHash, 'EX', RESET_TTL_SEC)

  const link = `${(process.env.FRONTEND_URL ?? 'http://localhost:5173').replace(/\/$/, '')}/reset-password?token=${token}`
  try {
    await sendEmail('reset', { to_email: user.email, to_name: user.name, reset_link: link, expires_minutes: RESET_TTL_SEC / 60 })
  } catch {
    // Already logged (status only). The answer to the user stays the same either way.
  }
}

/**
 * Sets a new password from a reset link. The link works once. Every other
 * session is signed out, and the email counts as confirmed (the link proved it).
 */
export async function resetPassword(token: string, password: string): Promise<void> {
  const tokenHash = sha256(token)
  // GETDEL: the link works once, even if submitted twice at the same moment
  const userId = await redis.getdel(resetKey(tokenHash))
  if (!userId) throw new AppError('LINK_EXPIRED', 'This reset link has expired or has already been used. Ask for a new one', 400)
  await redis.del(resetUserKey(userId))

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { emailVerifiedAt: true } })
  if (!user) throw new AppError('LINK_EXPIRED', 'This reset link has expired or has already been used. Ask for a new one', 400)

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(password), emailVerifiedAt: user.emailVerifiedAt ?? new Date() },
    }),
    prisma.refreshToken.updateMany({ where: { userId, revoked: false }, data: { revoked: true } }),
  ])
}

export async function getMe(userId: string): Promise<object> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      emailVerifiedAt: true,
      avatarUrl: true,
      createdAt: true,
      preferences: {
        select: {
          theme: true,
          units: true,
          notificationsEnabled: true,
          focusMode: true,
        },
      },
      // ── Include full profile so frontend gets gender, goals etc. ──
      profile: {
        select: {
          onboardingComplete: true,
          primaryGoal: true,
          gender: true,
          dateOfBirth: true,
          hasDisability: true,
          goalStepsPerDay: true,
          goalSleepHours: true,
          goalScreenMinutes: true,
          goalFocusMinutes: true,
          goalEcoActionsPerDay: true,
          goalSocialMinutes: true,
          goalEntertainmentMinutes: true,
          goalCaloriesPerDay: true,
          heightCm: true,
          weightKg: true,
        },
      },
    },
  })
  if (!user) throw new AppError('NOT_FOUND', 'User not found', 404)
  return user
}