import type { Insight } from '@prisma/client'
import { prisma } from '../db/prisma'
import {
  analyzeUser,
  loggedDays,
  pairProgress,
  passesKeep,
  passesNew,
  passesReturn,
  type FeatureDay,
  type TestResult,
} from '../insights/analyze'
import { INSIGHT_SETTINGS, type FeatureKey } from '../insights/config'
import { AREA_LABEL, describeInsight, displayValue, outcomeScaleMax, progressMessage } from '../insights/wording'
import { addDays, dayKey, startOfDay } from '../utils/day'

// ─── Runs the analysis for a user and keeps their Insight rows up to date ───

const FEATURE_SELECT = {
  date: true,
  sleepMinutes: true,
  steps: true,
  screenMinutes: true,
  socialMinutes: true,
  entertainmentMinutes: true,
  focusMinutes: true,
  studyMinutes: true,
  moodValue: true,
  stressScore: true,
  caloriesIn: true,
  waterGlasses: true,
  ecoActions: true,
  cyclePhase: true,
  cycleDay: true,
} as const

async function loadFeatureDays(userId: string, today: string): Promise<FeatureDay[]> {
  const rows = await prisma.dailyFeatures.findMany({
    where: { userId, date: { gte: startOfDay(addDays(today, -INSIGHT_SETTINGS.windowDays - 1)), lt: startOfDay(today) } },
    select: FEATURE_SELECT,
    orderBy: { date: 'asc' },
  })
  return rows.map(({ date, cyclePhase, cycleDay, ...values }) => ({ date: dayKey(date), cyclePhase, cycleDay, values }))
}

/** Fields written whenever a result is saved */
function resultFields(r: TestResult) {
  const copy = describeInsight(r)
  return {
    driver: r.driver,
    outcome: r.outcome,
    lag: r.lag,
    direction: r.effect! > 0 ? 'positive' : 'negative',
    effect: r.effect!,
    strength: r.strength!,
    rho: r.rho ?? null,
    groupLabelLow: copy.groupLabelLow,
    groupLabelHigh: copy.groupLabelHigh,
    meanLow: r.meanLow!,
    meanHigh: r.meanHigh!,
    nDays: r.pairedDays,
    qValue: r.q!,
    text: copy.text,
  }
}

export interface RefreshSummary {
  tested: number
  active: number
}

/**
 * Re-runs every test for the user and updates their insights:
 * - new and strong enough → created as active
 * - active and still holding (looser bar, so it doesn't flicker) → refreshed
 * - active and no longer holding → stale (kept, not deleted)
 * - stale and strong again → active
 * - dismissed → stays dismissed unless much stronger than when dismissed
 */
export async function refreshInsights(userId: string, today: string = dayKey()): Promise<RefreshSummary> {
  const [days, loggedCycles, existing] = await Promise.all([
    loadFeatureDays(userId, today),
    prisma.cycleLog.count({ where: { userId } }),
    prisma.insight.findMany({ where: { userId } }),
  ])
  const results = analyzeUser(days, { today, loggedCycles })
  const byKey = new Map(existing.map((i) => [i.key, i]))
  const seen = new Set<string>()
  const writes = []

  for (const r of results) {
    seen.add(r.key)
    const prev = byKey.get(r.key)

    if (!prev) {
      if (passesNew(r)) writes.push(prisma.insight.create({ data: { userId, key: r.key, ...resultFields(r) } }))
      continue
    }

    if (prev.status === 'active') {
      writes.push(
        passesKeep(r)
          ? prisma.insight.update({ where: { id: prev.id }, data: resultFields(r) })
          : prisma.insight.update({ where: { id: prev.id }, data: { status: 'stale' } }),
      )
    } else if (prev.status === 'stale') {
      if (passesNew(r)) writes.push(prisma.insight.update({ where: { id: prev.id }, data: { ...resultFields(r), status: 'active' } }))
    } else if (prev.status === 'dismissed') {
      if (passesReturn(r, prev.dismissedEffect ?? prev.effect)) {
        writes.push(
          prisma.insight.update({
            where: { id: prev.id },
            data: { ...resultFields(r), status: 'active', feedback: null, dismissedEffect: null },
          }),
        )
      }
    }
  }

  // A pair removed from the config can't be re-tested — retire its insight
  for (const prev of existing) {
    if (!seen.has(prev.key) && prev.status === 'active') {
      writes.push(prisma.insight.update({ where: { id: prev.id }, data: { status: 'stale' } }))
    }
  }

  await prisma.$transaction(writes)
  const active = await prisma.insight.count({ where: { userId, status: 'active' } })
  return { tested: results.filter((r) => r.testable).length, active }
}

// ─── What the API returns ───────────────────────────────────────────────────

export interface InsightView {
  id: string
  key: string
  text: string
  driver: string
  outcome: string
  lag: string
  nDays: number
  feedback: string | null
  firstFoundAt: Date
  /** The two bars, in the units the app shows (stress on 1–5) */
  comparison: {
    low: { label: string; value: number }
    high: { label: string; value: number }
    unit: 'score' | 'minutes' | 'steps'
    scaleMax: number | null
  }
}

export function toView(i: Insight): InsightView {
  const outcome = i.outcome as FeatureKey
  const unit = outcome === 'sleepMinutes' || outcome === 'focusMinutes' ? 'minutes' : outcome === 'steps' ? 'steps' : 'score'
  const round = (v: number) => Math.round(v * 10) / 10
  return {
    id: i.id,
    key: i.key,
    text: i.text,
    driver: i.driver,
    outcome: i.outcome,
    lag: i.lag,
    nDays: i.nDays,
    feedback: i.feedback,
    firstFoundAt: i.firstFoundAt,
    comparison: {
      low: { label: i.groupLabelLow, value: round(displayValue(outcome, i.meanLow)) },
      high: { label: i.groupLabelHigh, value: round(displayValue(outcome, i.meanHigh)) },
      unit,
      scaleMax: outcomeScaleMax(outcome),
    },
  }
}

/** The user's active insights, strongest first */
export async function activeInsights(userId: string, limit?: number): Promise<Insight[]> {
  return prisma.insight.findMany({
    where: { userId, status: 'active' },
    orderBy: [{ strength: 'desc' }, { firstFoundAt: 'asc' }],
    ...(limit ? { take: limit } : {}),
  })
}

// ─── Progress for users without insights yet ────────────────────────────────

const PROGRESS_AREAS: FeatureKey[] = [
  'sleepMinutes', 'moodValue', 'stressScore', 'steps', 'screenMinutes', 'focusMinutes',
  'studyMinutes', 'waterGlasses', 'caloriesIn', 'ecoActions',
]

export interface InsightStatus {
  windowDays: number
  minDays: number
  activeCount: number
  /** Days with each kind of log in the last `windowDays` days */
  areas: { area: FeatureKey; label: string; days: number }[]
  /** The tests closest to having enough data, nearest first */
  nextUp: { key: string; pairedDays: number; daysNeeded: number; message: string }[]
}

export async function insightStatus(userId: string, today: string = dayKey()): Promise<InsightStatus> {
  const [days, loggedCycles, activeCount] = await Promise.all([
    loadFeatureDays(userId, today),
    prisma.cycleLog.count({ where: { userId } }),
    prisma.insight.count({ where: { userId, status: 'active' } }),
  ])
  const min = INSIGHT_SETTINGS.minPairedDays

  const nextUp = pairProgress(days, { today, loggedCycles })
    .filter((p) => p.pairedDays < min)
    .map((p) => ({
      key: p.key,
      pairedDays: p.pairedDays,
      daysNeeded: min - p.pairedDays,
      message: progressMessage(p.driver, p.outcome, min - p.pairedDays),
    }))
    .sort((a, b) => a.daysNeeded - b.daysNeeded)
    .slice(0, 3)

  return {
    windowDays: INSIGHT_SETTINGS.windowDays,
    minDays: min,
    activeCount,
    areas: PROGRESS_AREAS.map((area) => ({ area, label: AREA_LABEL[area], days: loggedDays(days, area, today) })),
    nextUp,
  }
}
