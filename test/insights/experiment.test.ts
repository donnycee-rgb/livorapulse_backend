import { describe, expect, it, vi } from 'vitest'
import type { FeatureDay } from '../../src/insights/analyze'
import { evaluateExperiment, readyDay } from '../../src/insights/experiment'
import { seededRandom } from '../../src/insights/stats'
import { experimentSuggestion } from '../../src/insights/wording'
import { toExperimentView } from '../../src/services/ExperimentService'
import { addDays } from '../../src/utils/day'

// ExperimentService loads the database client; vi.mock is hoisted above the imports
vi.mock('../../src/db/prisma', () => ({ prisma: {} }))

const BASELINE = '2026-09-01'
const START = '2026-09-15' // 14 days later

type Values = FeatureDay['values']

/** 29 days (baseline, experiment, one extra for same-night outcomes) built from a per-day function */
function days(make: (dayIndex: number, during: boolean, rand: () => number) => Values): FeatureDay[] {
  const rand = seededRandom(99)
  return Array.from({ length: 29 }, (_, i) => ({
    date: addDays(BASELINE, i),
    cyclePhase: null,
    cycleDay: null,
    values: make(i, i >= 14, rand),
  }))
}

const SOCIAL_FOCUS = 'socialMinutes->focusMinutes:same-day'
const SLEEP_STRESS = 'sleepMinutes->stressScore:same-day'

describe('evaluateExperiment', () => {
  it('reports a clear improvement, the driver change and adherence', () => {
    const r = evaluateExperiment({
      insightKey: SOCIAL_FOCUS,
      baselineStartKey: BASELINE,
      startKey: START,
      days: days((_, during, rand) => ({
        socialMinutes: during ? 60 + Math.round(rand() * 20) : 160 + Math.round(rand() * 20),
        focusMinutes: during ? 95 + Math.round(rand() * 20) : 50 + Math.round(rand() * 20),
      })),
      checkins: Array.from({ length: 12 }, (_, i) => ({ date: addDays(START, i), did: i < 9 })),
    })
    expect(r.verdict).toBe('improved')
    expect(r.difference!).toBeGreaterThan(30)
    expect(r.before.days).toBe(14)
    expect(r.during.days).toBe(14)
    expect(r.driverDuring.mean!).toBeLessThan(r.driverBefore.mean!)
    expect(r.daysDone).toBe(9)
    expect(r.daysAnswered).toBe(12)
    expect(r.text).toContain('up from')
    expect(r.text).toContain('other things in your life may have changed')
    expect(r.text).toContain('You said you stuck to it on 9 of the 12 days you checked in.')
  })

  it('calls higher stress "worse" — lower is better for stress', () => {
    const r = evaluateExperiment({
      insightKey: SLEEP_STRESS,
      baselineStartKey: BASELINE,
      startKey: START,
      days: days((_, during, rand) => ({
        sleepMinutes: 420,
        stressScore: during ? 8 + (rand() < 0.5 ? 0 : 2) : 4 + (rand() < 0.5 ? 0 : 2),
      })),
      checkins: [],
    })
    expect(r.verdict).toBe('worse')
    expect(r.text).toContain('It went the other way this time')
    expect(r.text).toContain('out of 5') // stress shown on the app's 1–5 scale
    expect(r.text).not.toContain('checked in')
  })

  it('rarely calls a change when nothing changed', () => {
    let clear = 0
    for (let s = 1; s <= 100; s++) {
      const rand = seededRandom(s)
      const r = evaluateExperiment({
        insightKey: SLEEP_STRESS,
        baselineStartKey: BASELINE,
        startKey: START,
        days: days(() => ({ sleepMinutes: 420, stressScore: 2 * (1 + Math.floor(rand() * 5)) })),
        checkins: [],
      })
      if (r.verdict !== 'no-clear-change') clear++
    }
    expect(clear).toBeLessThanOrEqual(8)
  })

  it('says so honestly when there is no clear change', () => {
    const r = evaluateExperiment({
      insightKey: SLEEP_STRESS,
      baselineStartKey: BASELINE,
      startKey: START,
      days: days((i) => ({ sleepMinutes: 420, stressScore: i % 2 === 0 ? 4 : 6 })),
      checkins: [],
    })
    expect(r.verdict).toBe('no-clear-change')
    expect(r.text).toContain('no clear change this time')
  })

  it('needs 5 logged days in each period', () => {
    const r = evaluateExperiment({
      insightKey: SLEEP_STRESS,
      baselineStartKey: BASELINE,
      startKey: START,
      days: days((i, during) => ({ sleepMinutes: 420, stressScore: !during || i < 18 ? 6 : null })),
      checkins: [],
    })
    expect(r.during.days).toBe(4)
    expect(r.verdict).toBe('not-enough-data')
    expect(r.difference).toBeNull()
    expect(r.text).toContain('you logged 14 days before and 4 days during')
  })

  it('reads same-night outcomes from the next day', () => {
    // Sleep stored on day D+1 is the night after day D: only those days count
    const r = evaluateExperiment({
      insightKey: 'screenMinutes->sleepMinutes:same-night',
      baselineStartKey: BASELINE,
      startKey: START,
      days: days((i) => ({ screenMinutes: 200, sleepMinutes: i === 0 ? null : 420 })),
      checkins: [],
    })
    // Day 0's sleep belongs to the night before the baseline; day 28's to the last experiment night
    expect(r.before.days).toBe(14)
    expect(r.during.days).toBe(14)
  })

  it('becomes ready once the last outcome day has ended', () => {
    expect(readyDay(START, 0)).toBe('2026-09-29') // day 14 is 09-28
    expect(readyDay(START, 1)).toBe('2026-09-30') // that night's sleep is stored on 09-29
  })
})

describe('experimentSuggestion', () => {
  const insight = { driver: 'socialMinutes', outcome: 'focusMinutes', meanLow: 70, meanHigh: 50, splitValue: 120 }

  it('aims for the side where the outcome was better', () => {
    expect(experimentSuggestion(insight)).toBe('Keep social media under 2h a day')
    // Short nights → more stress, so aim for more sleep
    expect(experimentSuggestion({ driver: 'sleepMinutes', outcome: 'stressScore', meanLow: 7.6, meanHigh: 5.8, splitValue: 360 }))
      .toBe('Sleep 6h or more each night')
    expect(experimentSuggestion({ driver: 'steps', outcome: 'moodValue', meanLow: 3.1, meanHigh: 3.9, splitValue: 6000 }))
      .toBe('Walk 6,000+ steps a day, and log your walks')
  })

  it('never suggests something unhealthy or untestable', () => {
    // Even if more screen time came with better sleep, that is not the suggestion
    expect(experimentSuggestion({ driver: 'screenMinutes', outcome: 'sleepMinutes', meanLow: 400, meanHigh: 440, splitValue: 200 })).toBeNull()
    expect(experimentSuggestion({ driver: 'sleepMinutes', outcome: 'moodValue', meanLow: 4, meanHigh: 3, splitValue: 360 })).toBeNull()
    expect(experimentSuggestion({ driver: 'caloriesIn', outcome: 'moodValue', meanLow: 3, meanHigh: 4, splitValue: 1800 })).toBeNull()
    expect(experimentSuggestion({ driver: 'cyclePhase', outcome: 'moodValue', meanLow: 3, meanHigh: 4, splitValue: null })).toBeNull()
  })
})

describe('toExperimentView', () => {
  const exp = {
    id: 'e1', userId: 'u1', insightKey: SOCIAL_FOCUS, driver: 'socialMinutes', outcome: 'focusMinutes', lag: 'same-day',
    change: 'Keep social media under 2h a day',
    baselineStart: new Date('2026-08-31T21:00:00Z'), baselineEnd: new Date('2026-09-13T21:00:00Z'),
    startDate: new Date('2026-09-14T21:00:00Z'), endDate: new Date('2026-09-27T21:00:00Z'), // Nairobi midnights
    status: 'active', result: null, createdAt: new Date(), updatedAt: new Date(),
    checkins: [
      { id: 'c1', experimentId: 'e1', date: new Date('2026-09-15T21:00:00Z'), did: true, createdAt: new Date(), updatedAt: new Date() },
    ],
  }

  it('numbers the days and shows the answers in local days', () => {
    const v = toExperimentView(exp, '2026-09-17')
    expect(v.startDate).toBe('2026-09-15')
    expect(v.endDate).toBe('2026-09-28')
    expect(v.dayNumber).toBe(3)
    expect(v.today).toBeNull()
    expect(v.yesterday).toBe(true)
    expect(v.waitingForResult).toBe(false)
  })

  it('shows "waiting for result" between day 14 and the result', () => {
    const v = toExperimentView(exp, '2026-09-29')
    expect(v.dayNumber).toBeNull()
    expect(v.waitingForResult).toBe(true)
  })
})
