import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../../src/db/prisma'
import { addDays, dayKey, startOfDay } from '../../src/utils/day'
import { computeFeatures, firstLogDay, loadFeatureDays } from '../../src/services/FeatureService'
import { activeInsights, insightStatus, refreshInsights, toView } from '../../src/services/InsightService'
import { checkIn, completeDueExperiments, listExperiments, startExperiment } from '../../src/services/ExperimentService'
import { buildSummaryFor, createShare, deleteExpiredShares, listShares, openShare, revokeShare } from '../../src/services/HealthSummaryService'
import { activeFlags, dismissFlag, refreshFlags } from '../../src/services/FlagService'
import { renderSummaryPdf } from '../../src/services/SummaryPdf'

// One user with 90 days of realistic logs, run through every service end to end

const today = dayKey()
const at = (daysAgo: number, hour: number) => new Date(startOfDay(addDays(today, -daysAgo)).getTime() + hour * 3600_000)
let seed = 7
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }

let userId = ''

beforeAll(async () => {
  process.env.HEALTH_FLAGS_ENABLED = 'true'
  const user = await prisma.user.create({
    data: {
      name: 'Service Test', email: `svc-${Date.now()}@example.test`,
      profile: { create: { gender: 'female', dateOfBirth: new Date('2004-03-02'), onboardingComplete: true, weightKg: 60, heightCm: 165 } },
    },
  })
  userId = user.id

  for (let d = 90; d >= 1; d--) {
    const dow = new Date(`${addDays(today, -d)}T00:00:00Z`).getUTCDay()
    const weekend = dow === 0 || dow === 6
    // Short sleep most nights in the last 3 weeks (for the flag); mixed before
    const sleep = d <= 21 ? (d % 4 === 0 ? 400 : 320) : 330 + Math.round(rand() * 150) + (weekend ? 30 : 0)
    if (d % 9 !== 0) await prisma.physicalActivityEntry.create({ data: { userId, steps: 0, distanceKm: 0, caloriesKcal: 0, sleepMinutes: sleep, timestamp: at(d, 7) } })
    // Planted effect: more stress after short nights (stored 1–10 in steps of 2)
    const stressLevel = Math.min(5, Math.max(1, Math.round((sleep < 360 ? 4 : 2) + (rand() - 0.5) * 1.5)))
    // Low mood most days in the last 2 weeks (for the flag)
    const emoji = d <= 14 ? (d % 5 === 0 ? '😐' : '😕') : ['😄', '🙂', '😐'][Math.floor(rand() * 3)]
    if (d % 7 !== 3) {
      // Partial check-ins: a mood-only row and a stress-only row on the same day
      await prisma.moodLog.create({ data: { userId, emoji, stressScore: null, timestamp: at(d, 9), note: d === 5 ? 'CAT week, barely slept' : null } })
      await prisma.moodLog.create({ data: { userId, emoji: null, stressScore: stressLevel * 2, timestamp: at(d, 18) } })
    }
    if (d % 3 === 0) await prisma.physicalActivityEntry.create({ data: { userId, steps: 4000 + Math.round(rand() * 4000), distanceKm: 3.1, caloriesKcal: 150, sleepMinutes: 0, timestamp: at(d, 17) } })
    await prisma.digitalUsageEntry.create({ data: { userId, screenTimeMinutes: 200, categoryBreakdown: { Social: 90 + Math.round(rand() * 90) }, date: at(d, 20) } })
    if (d % 2 === 0) await prisma.productivitySession.create({ data: { userId, kind: 'FOCUS', durationSec: 1800 + Math.round(rand() * 3600), startedAt: at(d, 10), endedAt: at(d, 11) } })
    if (d % 4 === 0) {
      await prisma.nutritionLog.create({ data: { userId, mealType: 'breakfast', foodName: 'Uji', calories: 300, timestamp: at(d, 8) } })
      await prisma.nutritionLog.create({ data: { userId, mealType: 'lunch', foodName: 'Ugali na sukuma', calories: 650, timestamp: at(d, 13) } })
    }
    if (d % 5 === 0) await prisma.ecoAction.create({ data: { userId, category: 'TRANSPORT', type: 'Driving', impactKgCO2: 0, timestamp: at(d, 8) } })
  }
  // Four periods: heavy flow and severe cramps on three of them
  for (const [i, s] of [86, 58, 30, 2].entries()) {
    await prisma.cycleLog.create({
      data: {
        userId, periodStartDate: at(s, 6), periodDuration: 5,
        flowIntensity: i === 1 ? 'medium' : 'heavy',
        symptoms: i === 1 ? ['Cramps'] : ['Severe cramps', 'Fatigue'],
        notes: i === 3 ? 'Worse than usual' : null,
      },
    })
  }
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } })
  await prisma.$disconnect()
})

describe('features', () => {
  it('builds one row per day, keeping missing values null', async () => {
    const first = await firstLogDay(userId)
    expect(first).toBe(addDays(today, -90))
    expect(await computeFeatures(userId, first!, addDays(today, -1))).toBe(90)

    const days = new Map((await loadFeatureDays(userId, first!, addDays(today, -1))).map((d) => [d.date, d]))
    expect(days.get(addDays(today, -9))!.values.sleepMinutes).toBeNull() // no sleep logged: null, not 0
    expect(days.get(addDays(today, -1))!.values.steps).toBeNull() // no walk that day
    const d1 = days.get(addDays(today, -1))!.values
    expect(d1.moodValue).not.toBeNull() // mood-only and stress-only rows combine
    expect(d1.stressScore).not.toBeNull()
    expect(days.get(addDays(today, -5))!.values.ecoActions).toBe(0) // only "Driving": a real 0
    expect(days.get(addDays(today, -4))!.values.caloriesIn).toBe(950) // two meals: counted
    expect([...days.values()].some((d) => d.cyclePhase)).toBe(true)
  })

  it('updates rows on a re-run instead of duplicating them', async () => {
    await computeFeatures(userId, addDays(today, -90), addDays(today, -1))
    expect(await prisma.dailyFeatures.count({ where: { userId } })).toBe(90)
  })
})

describe('insights', () => {
  it('finds the planted sleep → stress pattern', async () => {
    const r = await refreshInsights(userId, today)
    expect(r.tested).toBeGreaterThan(5)
    const found = (await activeInsights(userId)).find((i) => i.key === 'sleepMinutes->stressScore:same-day')
    expect(found).toBeDefined()
    const view = toView(found!)
    expect(view.text).toContain('Based on')
    expect(view.comparison.scaleMax).toBe(5)
  })

  it('keeps one row per pattern on a re-run', async () => {
    const before = await prisma.insight.count({ where: { userId } })
    await refreshInsights(userId, today)
    expect(await prisma.insight.count({ where: { userId } })).toBe(before)
  })

  it('reports progress', async () => {
    expect((await insightStatus(userId, today)).activeCount).toBeGreaterThan(0)
  })
})

describe('experiments', () => {
  it('runs one at a time, takes check-ins and finishes with a result', async () => {
    const insight = (await activeInsights(userId)).find((i) => i.splitValue !== null && !i.key.startsWith('cyclePhase'))!
    const exp = await startExperiment(userId, insight.id)
    await checkIn(userId, exp.id, true, 'today')
    await checkIn(userId, exp.id, false, 'today') // changing the answer replaces it
    expect(await prisma.experimentCheckin.count({ where: { experimentId: exp.id } })).toBe(1)
    await expect(startExperiment(userId, insight.id)).rejects.toThrow(/Finish or stop/)
    expect((await listExperiments(userId)).active?.dayNumber).toBe(1)

    // Past day 14 with nothing logged during: finished, honestly "not enough data"
    expect(await completeDueExperiments(userId, addDays(today, 16))).toBe(1)
    const done = await prisma.experiment.findUniqueOrThrow({ where: { id: exp.id } })
    expect(done.status).toBe('completed')
    expect((done.result as { verdict: string }).verdict).toBe('not-enough-data')
  })
})

describe('flags', () => {
  it('raises exactly the patterns in the data, and no unverified contacts', async () => {
    expect(await refreshFlags(userId, today)).toBe(4)
    const flags = await activeFlags(userId)
    expect(flags.map((f) => f.key).sort()).toEqual(['heavy-flow', 'low-mood', 'severe-pain', 'short-sleep'])
    expect(flags.every((f) => f.contacts.length === 0)).toBe(true)
  })

  it('keeps a dismissed flag hidden on the next run', async () => {
    const heavy = (await activeFlags(userId)).find((f) => f.key === 'heavy-flow')!
    await dismissFlag(userId, heavy.id)
    await refreshFlags(userId, today)
    expect((await activeFlags(userId)).some((f) => f.key === 'heavy-flow')).toBe(false)
  })
})

describe('health summary and sharing', () => {
  it('summarises 3 months with cycle, notes and flags, and renders a PDF', async () => {
    const s = await buildSummaryFor(userId, 3, true)
    expect(s.period.days).toBe(91)
    expect(s.sleep.daysLogged).toBeGreaterThan(70)
    expect(s.stress.average!).toBeGreaterThan(0)
    expect(s.stress.average!).toBeLessThanOrEqual(5) // shown on the 1–5 scale
    expect(s.cycle!.lengths.length).toBeGreaterThanOrEqual(2)
    expect(s.notes!.some((n) => n.text === 'CAT week, barely slept')).toBe(true)
    expect(s.flags).toHaveLength(3) // the dismissed one is left out
    expect((await buildSummaryFor(userId, 1, false)).notes).toBeNull()
    expect((await renderSummaryPdf(s)).subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('shares by link, counts views, revokes, and cleans up expired links', async () => {
    const share = await createShare(userId, 3, false)
    const stored = await prisma.sharedSummary.findUniqueOrThrow({ where: { id: share.id } })
    expect(stored.tokenHash).not.toBe(share.token) // only the hash is kept
    expect((await openShare(share.token)).period.days).toBe(91)
    expect((await listShares(userId))[0].viewCount).toBe(1)
    await revokeShare(userId, share.id)
    await expect(openShare(share.token)).rejects.toThrow(/expired or been revoked/)

    const old = await createShare(userId, 1, false)
    await prisma.sharedSummary.update({ where: { id: old.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
    await expect(openShare(old.token)).rejects.toThrow(/expired/)
    expect(await deleteExpiredShares()).toBe(1)
  })
})

describe('deleting a user', () => {
  it('removes their rows from every table', async () => {
    const expIds = (await prisma.experiment.findMany({ where: { userId }, select: { id: true } })).map((e) => e.id)
    await prisma.user.delete({ where: { id: userId } })
    const left = await Promise.all([
      prisma.dailyFeatures.count({ where: { userId } }),
      prisma.insight.count({ where: { userId } }),
      prisma.experiment.count({ where: { userId } }),
      prisma.experimentCheckin.count({ where: { experimentId: { in: expIds } } }),
      prisma.sharedSummary.count({ where: { userId } }),
      prisma.healthFlag.count({ where: { userId } }),
      prisma.moodLog.count({ where: { userId } }),
      prisma.cycleLog.count({ where: { userId } }),
    ])
    expect(left).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
  })
})
