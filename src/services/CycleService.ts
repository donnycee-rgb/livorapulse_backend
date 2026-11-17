import { prisma } from '../db/prisma'
import { dayKey } from '../utils/day'
import { cycleStats, cycleStatus, daysBetweenKeys, groupPeriods, type PeriodDayInput } from '../utils/cycle'

// ─── The cycle tracker: logged days in, everything else worked out ──────────

export const toDate = (key: string) => new Date(`${key}T00:00:00.000Z`)
const keyOf = (d: Date) => d.toISOString().slice(0, 10)

export async function loadDays(userId: string): Promise<PeriodDayInput[]> {
  const rows = await prisma.periodDay.findMany({
    where: { userId },
    orderBy: { date: 'asc' },
    select: { date: true, flow: true, symptoms: true, notes: true },
  })
  return rows.map((r) => ({ date: keyOf(r.date), flow: r.flow, symptoms: r.symptoms, notes: r.notes }))
}

export async function loadDefaults(userId: string) {
  const p = await prisma.userProfile.findUnique({ where: { userId }, select: { defaultCycleLength: true, defaultPeriodDuration: true } })
  return { cycleLength: p?.defaultCycleLength ?? null, periodLength: p?.defaultPeriodDuration ?? null }
}

/**
 * Rebuild the person's CycleLog rows (one per period) from their logged
 * days, so everything that reads periods (health flags, insights, the AI
 * coach, the health summary) sees the same periods the tracker shows.
 */
export async function syncCycleLogs(userId: string): Promise<void> {
  const [days, defaults] = await Promise.all([loadDays(userId), loadDefaults(userId)])
  const periods = groupPeriods(days)
  await prisma.$transaction([
    prisma.cycleLog.deleteMany({ where: { userId } }),
    prisma.cycleLog.createMany({
      data: periods.map((p, i) => {
        const gap = i > 0 ? daysBetweenKeys(periods[i - 1].start, p.start) : null
        return {
          userId,
          periodStartDate: toDate(p.start),
          periodDuration: Math.min(Math.max(p.days, 1), 15),
          cycleLength: defaults.cycleLength ?? 28,
          flowIntensity: p.heaviestFlow,
          symptoms: p.symptoms,
          notes: p.notes.length ? p.notes.join(' · ') : null,
          actualCycleLength: gap !== null && gap >= 15 && gap <= 60 ? gap : null,
        }
      }),
    }),
  ])
}

/** Everything the tracker shows about today */
export async function cycleOverview(userId: string, today = dayKey()) {
  const [days, defaults] = await Promise.all([loadDays(userId), loadDefaults(userId)])
  const periods = groupPeriods(days)
  const stats = cycleStats(periods, today, defaults)
  const status = cycleStatus(periods, stats, today)
  return { days, periods, stats, status }
}
