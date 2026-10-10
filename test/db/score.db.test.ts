import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../../src/db/prisma'
import { computeDailyScore } from '../../src/services/ScoreService'
import { addDays, dayKey, startOfDay } from '../../src/utils/day'

// The rolling LifePulse Score against a real database: it must not drop to 0
// at midnight, and summaries must record unlogged areas as null.

const today = dayKey()
const at = (daysAgo: number, hour: number) => new Date(startOfDay(addDays(today, -daysAgo)).getTime() + hour * 3600_000)
let userId = ''

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { name: 'Score Test', email: `score-${Date.now()}@example.test`, profile: { create: { onboardingComplete: true } } },
  })
  userId = user.id
  // Three good days: a walk, decent sleep and a good mood each day; no eco, food or screen logs
  for (const d of [3, 2, 1]) {
    await prisma.physicalActivityEntry.create({ data: { userId, steps: 0, distanceKm: 0, caloriesKcal: 0, sleepMinutes: 450, timestamp: at(d, 7) } })
    await prisma.physicalActivityEntry.create({ data: { userId, steps: 7500, distanceKm: 5.5, caloriesKcal: 250, sleepMinutes: 0, timestamp: at(d, 17) } })
    await prisma.moodLog.create({ data: { userId, emoji: '🙂', stressScore: 4, timestamp: at(d, 12) } })
    // As the nightly job does: finalise each day's summary
    await computeDailyScore(userId, addDays(today, -d))
  }
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } })
  await prisma.$disconnect()
})

describe('rolling LifePulse Score', () => {
  it('keeps the recent score just after midnight, before anything is logged today', async () => {
    const yesterday = await computeDailyScore(userId, addDays(today, -1))
    const now = await computeDailyScore(userId, today)
    expect(yesterday.score).toBeGreaterThan(50)
    expect(now.score).toBe(yesterday.score) // same areas, same values: no drop at all
    expect(now.todayScore).toBe(0) // the old today-only way would have shown 0
  })

  it("leaves out areas that weren't tracked instead of counting them as 0", async () => {
    const now = await computeDailyScore(userId, today)
    expect(now.rolling.eco).toBeNull()
    expect(now.rolling.nutrition).toBeNull()
    expect(now.rolling.digital).toBeNull()
    expect(now.rolling.physical).toBeGreaterThan(0)
    expect(now.rolling.mood).toBeGreaterThan(0)
  })

  it('saves unlogged areas as null, so later days can tell them apart from a real 0', async () => {
    const row = await prisma.dailySummary.findFirstOrThrow({ where: { userId, date: startOfDay(addDays(today, -1)) } })
    expect(row.ecoScore).toBeNull()
    expect(row.nutritionScore).toBeNull()
    expect(row.physicalScore).toBeGreaterThan(0)
  })

  it("moves with today's logs", async () => {
    const before = (await computeDailyScore(userId, today)).score!
    await prisma.moodLog.create({ data: { userId, emoji: '😣', stressScore: 10, timestamp: new Date() } })
    const after = (await computeDailyScore(userId, today)).score!
    expect(after).toBeLessThan(before) // a rough day today lowers it…
    expect(after).toBeGreaterThan(before - 25) // …without wiping out the week
  })
})
