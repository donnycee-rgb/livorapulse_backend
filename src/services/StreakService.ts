import { prisma } from '../db/prisma'
import { redis } from '../db/redis'
import { addDays, dayKey, startOfDay } from '../utils/day'

// A streak is the number of consecutive local days with at least one log of
// any kind. Today counts once something is logged; until then the streak
// carries over from yesterday so it doesn't "break" first thing in the morning.

const LOOKBACK_DAYS = 120 // the highest multiplier tier is 60 days
const CACHE_TTL_SEC = 600

// The shared Redis client retries forever while disconnected, so cache calls
// get a short deadline — the database is the source of truth anyway.
function withTimeout<T>(p: Promise<T>, ms = 500): Promise<T | null> {
  return Promise.race([
    p.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ])
}

function streakKey(userId: string): string {
  return `streak:${userId}`
}

async function activeDayKeys(userId: string, asOf: string): Promise<Set<string>> {
  const since = startOfDay(addDays(asOf, -LOOKBACK_DAYS))
  const until = startOfDay(addDays(asOf, 1))
  const range = { gte: since, lt: until }
  const [physical, digital, productivity, mood, eco, nutrition, water, cycle] = await Promise.all([
    prisma.physicalActivityEntry.findMany({ where: { userId, timestamp: range }, select: { timestamp: true } }),
    prisma.digitalUsageEntry.findMany({ where: { userId, date: range }, select: { date: true } }),
    prisma.productivitySession.findMany({ where: { userId, startedAt: range }, select: { startedAt: true } }),
    prisma.moodLog.findMany({ where: { userId, timestamp: range }, select: { timestamp: true } }),
    prisma.ecoAction.findMany({ where: { userId, timestamp: range }, select: { timestamp: true } }),
    prisma.nutritionLog.findMany({ where: { userId, timestamp: range }, select: { timestamp: true } }),
    prisma.waterLog.findMany({ where: { userId, timestamp: range }, select: { timestamp: true } }),
    prisma.cycleLog.findMany({ where: { userId, createdAt: range }, select: { createdAt: true } }),
  ])

  const keys = new Set<string>()
  physical.forEach((e) => keys.add(dayKey(e.timestamp)))
  digital.forEach((e) => keys.add(dayKey(e.date)))
  productivity.forEach((e) => keys.add(dayKey(e.startedAt)))
  mood.forEach((e) => keys.add(dayKey(e.timestamp)))
  eco.forEach((e) => keys.add(dayKey(e.timestamp)))
  nutrition.forEach((e) => keys.add(dayKey(e.timestamp)))
  water.forEach((e) => keys.add(dayKey(e.timestamp)))
  cycle.forEach((e) => keys.add(dayKey(e.createdAt)))
  return keys
}

/**
 * Recalculate the streak from the database as of a given day (default: today).
 * Today's value is cached for the /streak endpoint.
 */
export async function computeStreak(userId: string, asOf: string = dayKey()): Promise<number> {
  const keys = await activeDayKeys(userId, asOf)

  let cursor = keys.has(asOf) ? asOf : addDays(asOf, -1)
  let streak = 0
  while (keys.has(cursor)) {
    streak += 1
    cursor = addDays(cursor, -1)
  }

  if (asOf === dayKey()) {
    await withTimeout(redis.set(streakKey(userId), String(streak), 'EX', CACHE_TTL_SEC))
  }
  return streak
}

/** Cached streak — falls back to a fresh calculation if the cache is empty or Redis is down */
export async function getStreak(userId: string): Promise<number> {
  const cached = await withTimeout(redis.get(streakKey(userId)))
  if (cached !== null && cached !== undefined) {
    const n = parseInt(cached, 10)
    if (Number.isFinite(n)) return n
  }
  return computeStreak(userId)
}

export function getStreakMultiplier(streak: number): number {
  if (streak >= 60) return 1.5
  if (streak >= 30) return 1.35
  if (streak >= 14) return 1.2
  if (streak >= 7) return 1.1
  return 1.0
}
