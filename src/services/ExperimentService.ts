import { Prisma, type Experiment, type ExperimentCheckin } from '@prisma/client'
import { prisma } from '../db/prisma'
import { EXPERIMENT_SETTINGS } from '../insights/config'
import { evaluateExperiment, pairForKey, readyDay, type ExperimentResult } from '../insights/experiment'
import { experimentSuggestion } from '../insights/wording'
import { addDays, dayKey, startOfDay } from '../utils/day'
import { AppError } from '../utils/response'
import { loadFeatureDays } from './FeatureService'

// ─── 14-day experiments started from an insight ─────────────────────────────

const DAYS = EXPERIMENT_SETTINGS.days

/** One experiment at a time keeps it clear what changed */
export async function startExperiment(userId: string, insightId: string, customChange?: string): Promise<Experiment> {
  const insight = await prisma.insight.findFirst({ where: { id: insightId, userId, status: 'active' } })
  if (!insight) throw new AppError('NOT_FOUND', 'Insight not found', 404)

  const pair = pairForKey(insight.key)
  const suggestion = experimentSuggestion(insight)
  if (!pair || !suggestion) throw new AppError('NO_EXPERIMENT', "This insight doesn't have a change to try", 400)

  const running = await prisma.experiment.findFirst({ where: { userId, status: 'active' }, select: { id: true } })
  if (running) throw new AppError('EXPERIMENT_RUNNING', 'Finish or stop your current experiment first', 409)

  // Day 1 is today; the baseline is the 14 days before
  const today = dayKey()
  return prisma.experiment.create({
    data: {
      userId,
      insightKey: insight.key,
      driver: insight.driver,
      outcome: insight.outcome,
      lag: insight.lag,
      change: customChange?.trim() || suggestion,
      baselineStart: startOfDay(addDays(today, -DAYS)),
      baselineEnd: startOfDay(addDays(today, -1)),
      startDate: startOfDay(today),
      endDate: startOfDay(addDays(today, DAYS - 1)),
    },
  })
}

async function ownedActive(userId: string, id: string): Promise<Experiment> {
  const exp = await prisma.experiment.findFirst({ where: { id, userId } })
  if (!exp) throw new AppError('NOT_FOUND', 'Experiment not found', 404)
  if (exp.status !== 'active') throw new AppError('EXPERIMENT_ENDED', 'This experiment has ended', 409)
  return exp
}

/** "Did you do it today?" — today, or yesterday if the user forgot to answer */
export async function checkIn(userId: string, id: string, did: boolean, day: 'today' | 'yesterday'): Promise<void> {
  const exp = await ownedActive(userId, id)
  const key = day === 'today' ? dayKey() : addDays(dayKey(), -1)
  if (key < dayKey(exp.startDate) || key > dayKey(exp.endDate)) {
    throw new AppError('OUTSIDE_EXPERIMENT', 'That day is outside the experiment', 400)
  }
  const date = startOfDay(key)
  await prisma.experimentCheckin.upsert({
    where: { experimentId_date: { experimentId: id, date } },
    create: { experimentId: id, date, did },
    update: { did },
  })
}

export async function stopExperiment(userId: string, id: string): Promise<void> {
  await ownedActive(userId, id)
  await prisma.experiment.update({ where: { id }, data: { status: 'stopped' } })
}

/**
 * Works out the result of every active experiment whose last outcome day has
 * ended. Runs nightly, and before experiments are listed, so a result never
 * waits on the job.
 */
export async function completeDueExperiments(userId: string, today: string = dayKey()): Promise<number> {
  const active = await prisma.experiment.findMany({ where: { userId, status: 'active' }, include: { checkins: true } })
  let completed = 0
  for (const exp of active) {
    const pair = pairForKey(exp.insightKey)
    const startKey = dayKey(exp.startDate)
    if (!pair) {
      // The pair was removed from the config; there's nothing left to compare
      await prisma.experiment.update({ where: { id: exp.id }, data: { status: 'stopped' } })
      continue
    }
    if (today < readyDay(startKey, pair.offset)) continue

    const baselineStartKey = dayKey(exp.baselineStart)
    const days = await loadFeatureDays(userId, baselineStartKey, addDays(startKey, DAYS - 1 + pair.offset))
    const result = evaluateExperiment({
      insightKey: exp.insightKey,
      baselineStartKey,
      startKey,
      days,
      checkins: exp.checkins.map((c) => ({ date: dayKey(c.date), did: c.did })),
    })
    await prisma.experiment.update({
      where: { id: exp.id },
      data: { status: 'completed', result: result as unknown as Prisma.InputJsonValue },
    })
    completed++
  }
  return completed
}

// ─── What the API returns ───────────────────────────────────────────────────

export interface ExperimentView {
  id: string
  insightKey: string
  driver: string
  outcome: string
  change: string
  status: string
  startDate: string // YYYY-MM-DD
  endDate: string
  /** 1–14 while running */
  dayNumber: number | null
  totalDays: number
  /** Answer for today, if given */
  today: boolean | null
  /** Yesterday's answer, if it was an experiment day */
  yesterday: boolean | null
  checkins: { date: string; did: boolean }[]
  /** Set when the outcome window is still running past day 14 (same-night outcomes) */
  waitingForResult: boolean
  result: ExperimentResult | null
}

export function toExperimentView(exp: Experiment & { checkins: ExperimentCheckin[] }, today: string = dayKey()): ExperimentView {
  const startKey = dayKey(exp.startDate)
  const endKey = dayKey(exp.endDate)
  const checkins = exp.checkins
    .map((c) => ({ date: dayKey(c.date), did: c.did }))
    .sort((a, b) => a.date.localeCompare(b.date))
  const answer = (key: string) => checkins.find((c) => c.date === key)?.did ?? null
  const running = exp.status === 'active'
  const dayIndex = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${startKey}T00:00:00Z`)) / 86400000) + 1
  const yesterday = addDays(today, -1)

  return {
    id: exp.id,
    insightKey: exp.insightKey,
    driver: exp.driver,
    outcome: exp.outcome,
    change: exp.change,
    status: exp.status,
    startDate: startKey,
    endDate: endKey,
    dayNumber: running && dayIndex >= 1 && dayIndex <= DAYS ? dayIndex : null,
    totalDays: DAYS,
    today: answer(today),
    yesterday: yesterday >= startKey && yesterday <= endKey ? answer(yesterday) : null,
    checkins,
    waitingForResult: running && today > endKey,
    result: (exp.result as unknown as ExperimentResult | null) ?? null,
  }
}

/** The running experiment (if any) and the five most recent finished ones */
export async function listExperiments(userId: string): Promise<{ active: ExperimentView | null; past: ExperimentView[] }> {
  const today = dayKey()
  await completeDueExperiments(userId, today)
  const [active, past] = await Promise.all([
    prisma.experiment.findFirst({ where: { userId, status: 'active' }, include: { checkins: true } }),
    prisma.experiment.findMany({
      where: { userId, status: { in: ['completed', 'stopped'] } },
      include: { checkins: true },
      orderBy: { updatedAt: 'desc' },
      take: 5,
    }),
  ])
  return { active: active ? toExperimentView(active, today) : null, past: past.map((e) => toExperimentView(e, today)) }
}
