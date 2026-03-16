import { prisma } from '../db/prisma'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PhysicalAggregate {
  date: string
  steps: number
  distanceKm: number
  caloriesKcal: number
  sleepMinutes: number
}

export interface DigitalAggregate {
  date: string
  screenTimeMinutes: number
}

export interface ProductivityAggregate {
  date: string
  totalDurationSec: number
  sessionCount: number
}

export interface MoodAggregate {
  date: string
  avgStressScore: number
  logCount: number
}

export interface EcoAggregate {
  date: string
  totalImpactKgCO2: number
  actionCount: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sevenDaysAgo(): Date {
  const d = new Date()
  d.setDate(d.getDate() - 6)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// ─── Weekly aggregate functions ───────────────────────────────────────────────

export async function physicalWeekly(userId: string): Promise<PhysicalAggregate[]> {
  const entries = await prisma.physicalActivityEntry.findMany({
    where: { userId, timestamp: { gte: sevenDaysAgo() } },
    select: { steps: true, distanceKm: true, caloriesKcal: true, sleepMinutes: true, timestamp: true },
    orderBy: { timestamp: 'asc' },
  })

  const grouped = new Map<string, PhysicalAggregate>()
  for (const e of entries) {
    const key = toDateKey(e.timestamp)
    const existing = grouped.get(key) ?? { date: key, steps: 0, distanceKm: 0, caloriesKcal: 0, sleepMinutes: 0 }
    grouped.set(key, {
      date: key,
      steps: existing.steps + e.steps,
      distanceKm: existing.distanceKm + e.distanceKm,
      caloriesKcal: existing.caloriesKcal + e.caloriesKcal,
      sleepMinutes: existing.sleepMinutes + e.sleepMinutes,
    })
  }
  return Array.from(grouped.values())
}

export async function digitalWeekly(userId: string): Promise<DigitalAggregate[]> {
  const entries = await prisma.digitalUsageEntry.findMany({
    where: { userId, date: { gte: sevenDaysAgo() } },
    select: { screenTimeMinutes: true, date: true },
    orderBy: { date: 'asc' },
  })

  const grouped = new Map<string, DigitalAggregate>()
  for (const e of entries) {
    const key = toDateKey(e.date)
    const existing = grouped.get(key) ?? { date: key, screenTimeMinutes: 0 }
    grouped.set(key, { date: key, screenTimeMinutes: existing.screenTimeMinutes + e.screenTimeMinutes })
  }
  return Array.from(grouped.values())
}

export async function productivityWeekly(userId: string): Promise<ProductivityAggregate[]> {
  const sessions = await prisma.productivitySession.findMany({
    where: { userId, startedAt: { gte: sevenDaysAgo() } },
    select: { durationSec: true, startedAt: true },
    orderBy: { startedAt: 'asc' },
  })

  const grouped = new Map<string, ProductivityAggregate>()
  for (const s of sessions) {
    const key = toDateKey(s.startedAt)
    const existing = grouped.get(key) ?? { date: key, totalDurationSec: 0, sessionCount: 0 }
    grouped.set(key, {
      date: key,
      totalDurationSec: existing.totalDurationSec + s.durationSec,
      sessionCount: existing.sessionCount + 1,
    })
  }
  return Array.from(grouped.values())
}

export async function moodWeekly(userId: string): Promise<MoodAggregate[]> {
  const logs = await prisma.moodLog.findMany({
    where: { userId, timestamp: { gte: sevenDaysAgo() } },
    select: { stressScore: true, timestamp: true },
    orderBy: { timestamp: 'asc' },
  })

  const grouped = new Map<string, { date: string; sum: number; count: number }>()
  for (const l of logs) {
    const key = toDateKey(l.timestamp)
    const existing = grouped.get(key) ?? { date: key, sum: 0, count: 0 }
    grouped.set(key, { date: key, sum: existing.sum + l.stressScore, count: existing.count + 1 })
  }

  return Array.from(grouped.values()).map(({ date, sum, count }) => ({
    date,
    avgStressScore: count > 0 ? Math.round((sum / count) * 10) / 10 : 0,
    logCount: count,
  }))
}

export async function ecoWeekly(userId: string): Promise<EcoAggregate[]> {
  const actions = await prisma.ecoAction.findMany({
    where: { userId, timestamp: { gte: sevenDaysAgo() } },
    select: { impactKgCO2: true, timestamp: true },
    orderBy: { timestamp: 'asc' },
  })

  const grouped = new Map<string, EcoAggregate>()
  for (const a of actions) {
    const key = toDateKey(a.timestamp)
    const existing = grouped.get(key) ?? { date: key, totalImpactKgCO2: 0, actionCount: 0 }
    grouped.set(key, {
      date: key,
      totalImpactKgCO2: existing.totalImpactKgCO2 + a.impactKgCO2,
      actionCount: existing.actionCount + 1,
    })
  }
  return Array.from(grouped.values())
}
