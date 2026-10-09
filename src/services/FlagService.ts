import { Prisma, type HealthFlag } from '@prisma/client'
import { prisma } from '../db/prisma'
import { evaluateFlags, FLAG_SETTINGS, type RaisedFlag } from '../insights/flags'
import { describeFlag, flagSummaryLine, verifiedContacts, type FlagAction, type SupportContact } from '../insights/wording'
import { addDays, dayKey } from '../utils/day'
import { AppError } from '../utils/response'
import { loadFeatureDays } from './FeatureService'

// ─── "Worth getting checked" flags: evaluate, store, show ───────────────────

/**
 * Release switch. Flags are worked out and shown only when this is on, so
 * the wording and support contacts can be reviewed before anyone sees them.
 */
export function flagsEnabled(): boolean {
  return process.env.HEALTH_FLAGS_ENABLED === 'true'
}

const DAY_MS = 24 * 60 * 60 * 1000
type Evidence = Record<string, number | string | number[]>

/**
 * Re-checks every rule for the user and updates their flags:
 * - newly raised → active
 * - still raised → evidence refreshed (a dismissed one stays hidden for
 *   30 days, then shows again if the pattern is still there)
 * - no longer raised → resolved; if it comes back later it's raised afresh
 */
export async function refreshFlags(userId: string, today: string = dayKey()): Promise<number> {
  const longestWindow = Math.max(FLAG_SETTINGS.lowMood.weeks, FLAG_SETTINGS.shortSleep.weeks) * 7
  const [days, periods, existing] = await Promise.all([
    loadFeatureDays(userId, addDays(today, -longestWindow), addDays(today, -1)),
    prisma.cycleLog.findMany({ where: { userId }, orderBy: { periodStartDate: 'asc' }, select: { periodStartDate: true, flowIntensity: true, symptoms: true } }),
    prisma.healthFlag.findMany({ where: { userId } }),
  ])
  const raised = evaluateFlags({
    today,
    days,
    periods: periods.map((p) => ({ startKey: dayKey(p.periodStartDate), flowIntensity: p.flowIntensity, symptoms: p.symptoms })),
  })

  const now = new Date()
  const byKey = new Map(existing.map((f) => [f.key, f]))
  const raisedKeys = new Set(raised.map((f) => f.key))
  const writes: Prisma.PrismaPromise<unknown>[] = []

  for (const f of raised) {
    const evidence = f.evidence as Prisma.InputJsonValue
    const prev = byKey.get(f.key)
    if (!prev) {
      writes.push(prisma.healthFlag.create({ data: { userId, key: f.key, status: 'active', evidence } }))
    } else if (prev.status === 'resolved') {
      writes.push(prisma.healthFlag.update({ where: { id: prev.id }, data: { status: 'active', evidence, firstRaisedAt: now, lastSeenAt: now, dismissedAt: null } }))
    } else if (prev.status === 'dismissed' && prev.dismissedAt && now.getTime() - prev.dismissedAt.getTime() >= FLAG_SETTINGS.quietAfterDismissDays * DAY_MS) {
      writes.push(prisma.healthFlag.update({ where: { id: prev.id }, data: { status: 'active', evidence, lastSeenAt: now, dismissedAt: null } }))
    } else {
      writes.push(prisma.healthFlag.update({ where: { id: prev.id }, data: { evidence, lastSeenAt: now } }))
    }
  }
  for (const prev of existing) {
    if (!raisedKeys.has(prev.key as RaisedFlag['key']) && prev.status !== 'resolved') {
      writes.push(prisma.healthFlag.update({ where: { id: prev.id }, data: { status: 'resolved' } }))
    }
  }
  await prisma.$transaction(writes)
  return raised.length
}

export interface FlagView {
  id: string
  key: string
  title: string
  message: string
  why: string
  actions: FlagAction[]
  /** Support contacts — only verified ones, and only for flags that offer support */
  contacts: SupportContact[]
  firstRaisedAt: Date
}

export function toFlagView(f: HealthFlag): FlagView {
  const copy = describeFlag(f.key, f.evidence as Evidence)
  return {
    id: f.id,
    key: f.key,
    ...copy,
    contacts: copy.actions.includes('support') ? verifiedContacts() : [],
    firstRaisedAt: f.firstRaisedAt,
  }
}

async function activeRows(userId: string): Promise<HealthFlag[]> {
  if (!flagsEnabled()) return []
  return prisma.healthFlag.findMany({ where: { userId, status: 'active' }, orderBy: { firstRaisedAt: 'asc' } })
}

export async function activeFlags(userId: string): Promise<FlagView[]> {
  return (await activeRows(userId)).map(toFlagView)
}

/** One line per active flag, for the health summary */
export async function flagsForSummary(userId: string): Promise<{ title: string; detail: string }[]> {
  return (await activeRows(userId)).map((f) => flagSummaryLine(f.key, f.evidence as Evidence))
}

export async function dismissFlag(userId: string, id: string): Promise<void> {
  const { count } = await prisma.healthFlag.updateMany({
    where: { id, userId, status: 'active' },
    data: { status: 'dismissed', dismissedAt: new Date() },
  })
  if (count === 0) throw new AppError('NOT_FOUND', 'Flag not found', 404)
}
