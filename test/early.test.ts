import { describe, expect, it } from 'vitest'
import type { FeatureDay } from '../src/insights/analyze'
import { earlyLook } from '../src/insights/early'

const day = (date: string, values: FeatureDay['values']): FeatureDay => ({ date, values, cyclePhase: null, cycleDay: null })

describe('your days so far', () => {
  const days = [
    day('2026-11-10', { sleepMinutes: 480, moodValue: 4, stressScore: 4, steps: 7000 }),
    day('2026-11-11', { sleepMinutes: 450, moodValue: 4, stressScore: 6 }),
    day('2026-11-12', { sleepMinutes: 360, moodValue: 3, stressScore: 8, steps: 3000 }),
    day('2026-11-13', { sleepMinutes: 330, moodValue: 2, stressScore: 8, steps: 4000 }),
    day('2026-11-14', { moodValue: 5, steps: 9000 }),
    day('2026-11-15', {}),
  ]
  const e = earlyLook(days)

  it('counts the days anything was logged', () => {
    expect(e.daysLogged).toBe(5)
  })

  it('averages only what was logged, with how many days are behind each', () => {
    expect(e.averages.sleepMinutes).toEqual({ value: 405, days: 4 })
    expect(e.averages.mood).toEqual({ value: 3.6, days: 5 })
    expect(e.averages.stress).toEqual({ value: 3.3, days: 4 }) // stored 1–10, shown 1–5
    expect(e.averages.steps).toEqual({ value: 5750, days: 4 })
  })

  it('puts two kinds of day side by side, only from days with both logged', () => {
    const sleepMood = e.comparisons.find((c) => c.key === 'sleep-mood')!
    expect(sleepMood.b).toEqual({ label: 'After 7 h of sleep or more', value: 4, days: 2 })
    expect(sleepMood.a).toEqual({ label: 'After less than 7 h', value: 2.5, days: 2 })
  })

  it('needs at least 2 days on each side, and fills nothing in', () => {
    expect(e.comparisons.find((c) => c.key === 'steps-mood')).toMatchObject({ a: { days: 2 }, b: { days: 2 } })
    const thin = earlyLook(days.slice(0, 3))
    expect(thin.comparisons.find((c) => c.key === 'sleep-mood')).toBeUndefined() // only 1 short night
    expect(earlyLook([]).averages.mood).toBeNull()
  })
})
