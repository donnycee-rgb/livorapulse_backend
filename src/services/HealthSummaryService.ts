import { createHash, randomBytes } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma'
import { buildHealthSummary, SUMMARY_DAYS, type HealthSummary, type SummaryMonths, type SummaryNote } from '../insights/summary'
import { addDays, dayKey, startOfDay } from '../utils/day'
import { AppError } from '../utils/response'
import { loadFeatureDays } from './FeatureService'
import { activeInsights } from './InsightService'

// ─── Builds the user's health summary and manages share links ──────────────

/** Share links stop working after this many days */
export const SHARE_DAYS = 7
/** Open share links per user, so old ones don't pile up unnoticed */
const MAX_OPEN_SHARES = 5

export async function buildSummaryFor(userId: string, months: SummaryMonths, includeNotes: boolean): Promise<HealthSummary> {
  const today = dayKey()
  const from = addDays(today, -SUMMARY_DAYS[months])
  const range = { gte: startOfDay(from), lt: startOfDay(today) }

  const [user, days, periods, insights, moodNotes, cycleNotes] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true, profile: { select: { dateOfBirth: true, gender: true } } },
    }),
    loadFeatureDays(userId, from, addDays(today, -1)),
    prisma.cycleLog.findMany({
      where: { userId },
      orderBy: { periodStartDate: 'asc' },
      select: { periodStartDate: true, periodDuration: true, flowIntensity: true, symptoms: true },
    }),
    activeInsights(userId, 5),
    // Notes are read only when the user asked to include them
    includeNotes
      ? prisma.moodLog.findMany({ where: { userId, timestamp: range, note: { not: null } }, select: { note: true, timestamp: true } })
      : Promise.resolve([]),
    includeNotes
      ? prisma.cycleLog.findMany({ where: { userId, periodStartDate: range, notes: { not: null } }, select: { notes: true, periodStartDate: true } })
      : Promise.resolve([]),
  ])

  const notes: SummaryNote[] | null = includeNotes
    ? [
        ...moodNotes.map((n) => ({ date: dayKey(n.timestamp), area: 'Mood' as const, text: n.note ?? '' })),
        ...cycleNotes.map((n) => ({ date: dayKey(n.periodStartDate), area: 'Cycle' as const, text: n.notes ?? '' })),
      ]
    : null

  return buildHealthSummary({
    today,
    months,
    generatedAt: new Date(),
    person: {
      name: user.name,
      dateOfBirth: user.profile?.dateOfBirth ?? null,
      gender: user.profile?.gender && user.profile.gender !== 'prefer-not-to-say' ? user.profile.gender : null,
    },
    days,
    periods: periods.map((p) => ({
      startKey: dayKey(p.periodStartDate),
      periodDuration: p.periodDuration,
      flowIntensity: p.flowIntensity,
      symptoms: p.symptoms,
    })),
    insights: insights.map((i) => i.text),
    flags: [],
    notes,
  })
}

// ─── Share links ────────────────────────────────────────────────────────────

/** Only the hash is stored, so a leaked database can't be turned back into working links */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** 256 random bits, URL-safe */
export function newToken(): string {
  return randomBytes(32).toString('base64url')
}

export interface ShareView {
  id: string
  months: number
  includeNotes: boolean
  createdAt: Date
  expiresAt: Date
  viewCount: number
  lastViewedAt: Date | null
}

const SHARE_SELECT = {
  id: true, months: true, includeNotes: true, createdAt: true, expiresAt: true, viewCount: true, lastViewedAt: true,
} as const

/**
 * Saves a snapshot of the summary and returns the token for the link. The
 * token is returned only here; it can't be looked up again later.
 */
export async function createShare(userId: string, months: SummaryMonths, includeNotes: boolean): Promise<ShareView & { token: string }> {
  const open = await prisma.sharedSummary.count({ where: { userId, expiresAt: { gt: new Date() } } })
  if (open >= MAX_OPEN_SHARES) {
    throw new AppError('TOO_MANY_SHARES', `You have ${MAX_OPEN_SHARES} open links. Revoke one before making another.`, 409)
  }
  const summary = await buildSummaryFor(userId, months, includeNotes)
  const token = newToken()
  const share = await prisma.sharedSummary.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      months,
      includeNotes,
      data: summary as unknown as Prisma.InputJsonValue,
      expiresAt: new Date(Date.now() + SHARE_DAYS * 24 * 60 * 60 * 1000),
    },
    select: SHARE_SELECT,
  })
  return { ...share, token }
}

/** The user's links that still work */
export async function listShares(userId: string): Promise<ShareView[]> {
  return prisma.sharedSummary.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
    select: SHARE_SELECT,
    orderBy: { createdAt: 'desc' },
  })
}

/** Revoking deletes the link and its snapshot outright */
export async function revokeShare(userId: string, id: string): Promise<void> {
  const { count } = await prisma.sharedSummary.deleteMany({ where: { id, userId } })
  if (count === 0) throw new AppError('NOT_FOUND', 'Link not found', 404)
}

/** For the public link. Unknown, expired and revoked links all look the same: not found. */
export async function openShare(token: string): Promise<HealthSummary> {
  const share = await prisma.sharedSummary.findUnique({ where: { tokenHash: hashToken(token) } })
  if (!share || share.expiresAt <= new Date()) throw new AppError('NOT_FOUND', 'This link has expired or been revoked', 404)
  await prisma.sharedSummary.update({
    where: { id: share.id },
    data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
  })
  return share.data as unknown as HealthSummary
}

/** Nightly: expired snapshots are deleted, not kept */
export async function deleteExpiredShares(): Promise<number> {
  const { count } = await prisma.sharedSummary.deleteMany({ where: { expiresAt: { lte: new Date() } } })
  return count
}
