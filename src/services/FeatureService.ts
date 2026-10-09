import { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma'
import { computeSmartAverage } from '../routes/cycle'
import { buildDayFeatures, cycleForDay, emptyRawDay, isEmpty, type PeriodLog, type RawDay } from '../insights/features'
import { addDays, dayKey, startOfDay } from '../utils/day'

// ─── Builds and saves DailyFeatures rows from the raw logs ──────────────────
// The rules for each field are documented in insights/features.ts.

/** Every local day key from `from` to `to`, inclusive */
function dayRange(from: string, to: string): string[] {
  const keys: string[] = []
  for (let k = from; k <= to; k = addDays(k, 1)) keys.push(k)
  return keys
}

async function loadPeriods(userId: string): Promise<{ periods: PeriodLog[]; expectedLength: number }> {
  const [logs, profile] = await Promise.all([
    prisma.cycleLog.findMany({
      where: { userId },
      orderBy: { periodStartDate: 'asc' },
      select: { periodStartDate: true, periodDuration: true, cycleLength: true, actualCycleLength: true, symptoms: true },
    }),
    prisma.userProfile.findUnique({ where: { userId }, select: { defaultCycleLength: true } }),
  ])
  if (logs.length === 0) return { periods: [], expectedLength: 28 }

  // Same expected length the cycle tracker shows: smart average of the last 6
  const recent = logs.slice(-6).reverse()
  const latest = logs[logs.length - 1]
  const avg = computeSmartAverage(recent, profile?.defaultCycleLength ?? latest.cycleLength)
  return {
    periods: logs.map((l) => ({ startKey: dayKey(l.periodStartDate), periodDuration: l.periodDuration, symptoms: l.symptoms })),
    expectedLength: avg.cycleLength,
  }
}

/**
 * Recomputes and saves the features for each local day from `fromKey` to
 * `toKey` (inclusive). Days with nothing logged have no row; a row whose
 * logs were all deleted is removed. Returns the number of rows saved.
 */
export async function computeFeatures(userId: string, fromKey: string, toKey: string): Promise<number> {
  if (fromKey > toKey) return 0
  const range = { gte: startOfDay(fromKey), lt: startOfDay(addDays(toKey, 1)) }

  const [physical, digital, productivity, mood, nutrition, water, eco, cycle] = await Promise.all([
    prisma.physicalActivityEntry.findMany({
      where: { userId, timestamp: range },
      select: { steps: true, distanceKm: true, caloriesKcal: true, sleepMinutes: true, timestamp: true },
    }),
    prisma.digitalUsageEntry.findMany({ where: { userId, date: range }, select: { screenTimeMinutes: true, categoryBreakdown: true, date: true } }),
    prisma.productivitySession.findMany({ where: { userId, startedAt: range }, select: { kind: true, durationSec: true, startedAt: true } }),
    prisma.moodLog.findMany({ where: { userId, timestamp: range }, select: { emoji: true, stressScore: true, timestamp: true } }),
    prisma.nutritionLog.findMany({ where: { userId, timestamp: range }, select: { mealType: true, calories: true, proteinG: true, timestamp: true } }),
    prisma.waterLog.findMany({ where: { userId, timestamp: range }, select: { glasses: true, timestamp: true } }),
    prisma.ecoAction.findMany({ where: { userId, timestamp: range }, select: { impactKgCO2: true, timestamp: true } }),
    loadPeriods(userId),
  ])

  // Group every row by the local day it belongs to
  const days = new Map<string, RawDay>()
  const bucket = (at: Date) => {
    const key = dayKey(at)
    let d = days.get(key)
    if (!d) { d = emptyRawDay(); days.set(key, d) }
    return d
  }
  physical.forEach((e) => bucket(e.timestamp).physical.push(e))
  digital.forEach((e) => bucket(e.date).digital.push(e))
  productivity.forEach((e) => bucket(e.startedAt).productivity.push(e))
  mood.forEach((e) => bucket(e.timestamp).mood.push(e))
  nutrition.forEach((e) => bucket(e.timestamp).nutrition.push(e))
  water.forEach((e) => bucket(e.timestamp).water.push(e))
  eco.forEach((e) => bucket(e.timestamp).eco.push(e))

  const writes = []
  const emptyDates: Date[] = []
  for (const key of dayRange(fromKey, toKey)) {
    const f = buildDayFeatures(days.get(key) ?? emptyRawDay(), cycleForDay(key, cycle.periods, cycle.expectedLength))
    const date = startOfDay(key)
    if (isEmpty(f)) {
      emptyDates.push(date)
      continue
    }
    const { symptoms, ...values } = f
    writes.push(
      prisma.dailyFeatures.upsert({
        where: { userId_date: { userId, date } },
        create: { userId, date, ...values, symptoms: symptoms ?? undefined },
        update: { ...values, symptoms: symptoms ?? Prisma.JsonNull },
      }),
    )
  }

  // Cycle phase alone doesn't make a day worth keeping if nothing else was logged
  await prisma.$transaction([
    ...writes,
    prisma.dailyFeatures.deleteMany({ where: { userId, date: { in: emptyDates } } }),
  ])
  return writes.length
}

/** The first local day with any log, or null if the user has logged nothing */
export async function firstLogDay(userId: string): Promise<string | null> {
  const where = { userId }
  const firsts = await Promise.all([
    prisma.physicalActivityEntry.findFirst({ where, orderBy: { timestamp: 'asc' }, select: { timestamp: true } }).then((r) => r?.timestamp),
    prisma.digitalUsageEntry.findFirst({ where, orderBy: { date: 'asc' }, select: { date: true } }).then((r) => r?.date),
    prisma.productivitySession.findFirst({ where, orderBy: { startedAt: 'asc' }, select: { startedAt: true } }).then((r) => r?.startedAt),
    prisma.moodLog.findFirst({ where, orderBy: { timestamp: 'asc' }, select: { timestamp: true } }).then((r) => r?.timestamp),
    prisma.nutritionLog.findFirst({ where, orderBy: { timestamp: 'asc' }, select: { timestamp: true } }).then((r) => r?.timestamp),
    prisma.waterLog.findFirst({ where, orderBy: { timestamp: 'asc' }, select: { timestamp: true } }).then((r) => r?.timestamp),
    prisma.ecoAction.findFirst({ where, orderBy: { timestamp: 'asc' }, select: { timestamp: true } }).then((r) => r?.timestamp),
  ])
  const dates = firsts.filter((d): d is Date => d instanceof Date)
  if (dates.length === 0) return null
  return dayKey(new Date(Math.min(...dates.map((d) => d.getTime()))))
}
