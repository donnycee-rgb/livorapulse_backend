import { describe, expect, it, vi } from 'vitest'
import { buildDayFeatures, cycleForDay, emptyRawDay, isEmpty, type PeriodLog, type RawDay } from '../../src/insights/features'

// features.ts reuses the cycle tracker's phase logic, whose module also loads the database client
vi.mock('../../src/db/prisma', () => ({ prisma: {} }))

const at = (iso: string) => new Date(iso)
const walk = (steps: number, km: number, kcal: number, time = '2026-10-01T08:00:00Z') =>
  ({ steps, distanceKm: km, caloriesKcal: kcal, sleepMinutes: 0, timestamp: at(time) })
const sleep = (minutes: number, time = '2026-10-01T05:00:00Z') =>
  ({ steps: 0, distanceKm: 0, caloriesKcal: 0, sleepMinutes: minutes, timestamp: at(time) })
const day = (patch: Partial<RawDay>): RawDay => ({ ...emptyRawDay(), ...patch })

describe('buildDayFeatures: missing is null, never 0', () => {
  it('a day with nothing logged is all null', () => {
    const f = buildDayFeatures(emptyRawDay(), null)
    expect(isEmpty(f)).toBe(true)
  })

  it('a walk does not count as 0 minutes of sleep, and sleep does not count as 0 steps', () => {
    expect(buildDayFeatures(day({ physical: [walk(4000, 3, 150)] }), null).sleepMinutes).toBeNull()
    const f = buildDayFeatures(day({ physical: [sleep(420)] }), null)
    expect(f.sleepMinutes).toBe(420)
    expect(f.steps).toBeNull()
    expect(f.distanceKm).toBeNull()
  })

  it('takes the latest sleep value instead of adding them up', () => {
    const f = buildDayFeatures(day({ physical: [sleep(420, '2026-10-01T05:00:00Z'), sleep(480, '2026-10-01T06:00:00Z')] }), null)
    expect(f.sleepMinutes).toBe(480)
  })

  it('ignores impossible sleep values', () => {
    expect(buildDayFeatures(day({ physical: [sleep(23 * 60)] }), null).sleepMinutes).toBeNull()
  })

  it('sums walks; a calorie-only "other activity" is not a walk', () => {
    const other = { steps: 0, distanceKm: 0, caloriesKcal: 200, sleepMinutes: 0, timestamp: at('2026-10-01T15:00:00Z') }
    const f = buildDayFeatures(day({ physical: [walk(3000, 2, 100), walk(2000, 1.5, 80), other] }), null)
    expect(f.steps).toBe(5000)
    expect(f.distanceKm).toBeCloseTo(3.5)
    expect(f.activeCaloriesKcal).toBe(380)

    const onlyOther = buildDayFeatures(day({ physical: [other] }), null)
    expect(onlyOther.steps).toBeNull()
    expect(onlyOther.activeCaloriesKcal).toBe(200)
  })

  it('social and entertainment are 0 only on days with other screen time logged', () => {
    const f = buildDayFeatures(day({ digital: [{ screenTimeMinutes: 60, categoryBreakdown: { Productive: 60 } }] }), null)
    expect(f.screenMinutes).toBe(60)
    expect(f.socialMinutes).toBe(0)
    expect(f.entertainmentMinutes).toBe(0)

    const both = buildDayFeatures(day({
      digital: [
        { screenTimeMinutes: 45, categoryBreakdown: { Social: 45 } },
        { screenTimeMinutes: 30, categoryBreakdown: { Social: 30 } },
        { screenTimeMinutes: 90, categoryBreakdown: { Entertainment: 90 } },
      ],
    }), null)
    expect(both.socialMinutes).toBe(75)
    expect(both.entertainmentMinutes).toBe(90)

    expect(buildDayFeatures(emptyRawDay(), null).socialMinutes).toBeNull()
  })

  it('splits focus and study time and leaves either null when not logged', () => {
    const f = buildDayFeatures(day({ productivity: [{ kind: 'FOCUS', durationSec: 1500 }, { kind: 'FOCUS', durationSec: 900 }] }), null)
    expect(f.focusMinutes).toBe(40)
    expect(f.studyMinutes).toBeNull()
    expect(buildDayFeatures(day({ productivity: [{ kind: 'STUDY', durationSec: 1800 }] }), null).studyMinutes).toBe(30)
  })

  it('maps emojis to 1–5, skips unknown ones and stress-only check-ins', () => {
    const f = buildDayFeatures(day({
      mood: [
        { emoji: '😄', stressScore: 2 },
        { emoji: '😕', stressScore: null },
        { emoji: '🦄', stressScore: null },
        { emoji: null, stressScore: 6 },
      ],
    }), null)
    expect(f.moodValue).toBe(3.5) // (5 + 2) / 2
    expect(f.stressScore).toBe(4) // (2 + 6) / 2

    const stressOnly = buildDayFeatures(day({ mood: [{ emoji: null, stressScore: 8 }] }), null)
    expect(stressOnly.moodValue).toBeNull()
    expect(stressOnly.stressScore).toBe(8)
  })

  it('only counts food on days with at least two different meals logged', () => {
    const snack = { mealType: 'snack', calories: 300, proteinG: 5 }
    expect(buildDayFeatures(day({ nutrition: [snack, { ...snack }] }), null).caloriesIn).toBeNull()
    const f = buildDayFeatures(day({ nutrition: [snack, { mealType: 'lunch', calories: 700, proteinG: 30 }] }), null)
    expect(f.caloriesIn).toBe(1000)
    expect(f.proteinG).toBe(35)
  })

  it('counts eco actions that saved CO₂; a day with only "Driving" is a real 0', () => {
    expect(buildDayFeatures(day({ eco: [{ impactKgCO2: 0 }] }), null).ecoActions).toBe(0)
    expect(buildDayFeatures(day({ eco: [{ impactKgCO2: 0.5 }, { impactKgCO2: 0.2 }, { impactKgCO2: 0 }] }), null).ecoActions).toBe(2)
    expect(buildDayFeatures(emptyRawDay(), null).ecoActions).toBeNull()
  })

  it('sums water', () => {
    expect(buildDayFeatures(day({ water: [{ glasses: 3 }, { glasses: 2 }] }), null).waterGlasses).toBe(5)
  })
})

describe('cycleForDay', () => {
  const periods: PeriodLog[] = [
    { startKey: '2026-07-01', periodDuration: 5, symptoms: ['cramps', 'fatigue'] },
    { startKey: '2026-07-31', periodDuration: 4, symptoms: [] },
  ]

  it('is null before the first logged period', () => {
    expect(cycleForDay('2026-06-30', periods, 28)).toBeNull()
  })

  it('uses the real length of a finished cycle (30 days here, not the expected 28)', () => {
    // Day 16 of a 30-day cycle: ovulation is day 16 → still "ovulation"; with 28 it would be luteal
    const c = cycleForDay('2026-07-16', periods, 28)!
    expect(c.cycleDay).toBe(16)
    expect(c.phase).toBe('ovulation')
  })

  it('attaches the period symptoms to the period days only', () => {
    expect(cycleForDay('2026-07-02', periods, 28)!.symptoms).toEqual(['cramps', 'fatigue'])
    expect(cycleForDay('2026-07-10', periods, 28)!.symptoms).toBeNull()
  })

  it('uses the expected length for the current cycle', () => {
    const c = cycleForDay('2026-08-20', periods, 28)!
    expect(c.cycleDay).toBe(21)
    expect(c.phase).toBe('luteal')
  })

  it('stops guessing when the current cycle runs far past its expected length', () => {
    expect(cycleForDay('2026-09-06', periods, 28)!.phase).toBe('luteal') // day 38: late, still plausible
    expect(cycleForDay('2026-09-08', periods, 28)).toBeNull() // day 40: a period was probably not logged
  })
})
