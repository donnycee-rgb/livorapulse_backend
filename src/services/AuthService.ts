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
import type { RegisterInput, LoginInput } from '../schemas/auth.schema'

export interface AuthUser {
  id: string
  name: string
  email: string
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
}

export interface AuthResult extends TokenPair {
  user: AuthUser
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

export async function issueTokensForUser(userId: string, email: string): Promise<TokenPair> {
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
      select: { id: true, name: true, email: true },
    })
    return created
  })

  const tokens = await issueTokens(user.id, user.email)
  return { user, ...tokens }
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, name: true, email: true, passwordHash: true },
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
  return { user: { id: user.id, name: user.name, email: user.email }, ...tokens }
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

export async function forgotPassword(email: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true },
  })

  if (!user) return

  const resetToken = crypto.randomBytes(32).toString('hex')
  await redis.set(`pw_reset:${user.id}`, resetToken, 'EX', 3600)

  const resetUrl = `${process.env.FRONTEND_URL ?? 'http://localhost:5173'}/reset-password?token=${resetToken}&userId=${user.id}`

  if (process.env.NODE_ENV === 'production') {
    console.log(`[TODO] Send password reset email to ${user.email}`)
  } else {
    console.log(`[DEV] Password reset URL for ${user.email}: ${resetUrl}`)
  }
}

export async function getMe(userId: string): Promise<object> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
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
        },
      },
    },
  })
  if (!user) throw new AppError('NOT_FOUND', 'User not found', 404)
  return user
}