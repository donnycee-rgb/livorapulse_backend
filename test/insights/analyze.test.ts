import { describe, expect, it } from 'vitest'
import {
  analyzeUser,
  chooseSplit,
  passesKeep,
  passesNew,
  passesReturn,
  type FeatureDay,
  type TestResult,
} from '../../src/insights/analyze'
import { INSIGHT_SETTINGS } from '../../src/insights/config'
import { syntheticUser, TODAY } from './synthetic'

const SLEEP_STRESS = 'sleepMinutes->stressScore:same-day'

/** Stress up by `steps` slider steps (2 points each on the stored 1–10 scale) after nights under 6.5 h */
function plantSleepStress(steps: number) {
  return (d: FeatureDay) => {
    const sleep = d.values.sleepMinutes
    if (sleep != null && sleep < 390 && d.values.stressScore != null) {
      d.values.stressScore = Math.min(10, d.values.stressScore + steps * 2)
    }
  }
}

const find = (results: TestResult[], key: string) => results.find((r) => r.key === key)!

describe('chooseSplit', () => {
  const values = [300, 330, 360, 390, 420, 420, 420, 450, 480, 510]

  it('uses the threshold when both sides have enough days', () => {
    expect(chooseSplit(values, 400, 3, 0.2)).toEqual({ value: 400, mode: 'below', source: 'threshold' })
  })

  it('falls back to the median when the threshold leaves too few days on one side', () => {
    expect(chooseSplit(values, 310, 3, 0.2)?.source).toBe('median')
  })

  it('switches to at-or-below the median when ties leave the low side too small', () => {
    const tied = [1, 2, 2, 2, 2, 2, 2, 3, 4, 5]
    expect(chooseSplit(tied, undefined, 3, 0.2)).toEqual({ value: 2, mode: 'atOrBelow', source: 'median' })
  })

  it('gives up when no split works', () => {
    expect(chooseSplit([5, 5, 5, 5, 5, 5], undefined, 3, 0.2)).toBeNull()
  })
})

describe('analyzeUser: planted effects', () => {
  it('finds a strong sleep → stress effect with the right direction and numbers', () => {
    const days = syntheticUser({ seed: 11, missing: 0.1, plant: plantSleepStress(3) })
    const r = find(analyzeUser(days, { today: TODAY, loggedCycles: 0 }), SLEEP_STRESS)
    expect(passesNew(r)).toBe(true)
    expect(r.meanLow!).toBeGreaterThan(r.meanHigh!) // short nights → more stress
    expect(r.effect!).toBeLessThan(0) // stress falls as sleep rises
    expect(r.rho!).toBeLessThan(0)
    expect(r.nLow! + r.nHigh!).toBe(r.pairedDays)
  })

  it('finds a large planted effect in most users despite gaps in logging', () => {
    let found = 0
    for (let s = 1; s <= 40; s++) {
      const days = syntheticUser({ seed: s * 104729, plant: plantSleepStress(3) })
      if (passesNew(find(analyzeUser(days, { today: TODAY, loggedCycles: 0 }), SLEEP_STRESS))) found++
    }
    expect(found / 40).toBeGreaterThanOrEqual(0.6)
  }, 120_000)

  it('applies the same-night lag: steps on a day vs the sleep stored on the next day', () => {
    // Sleep stored on day D+1 is the night after day D; plant more sleep after
    // longer walks. Walks follow a 5-day pattern so weekends don't explain it.
    const days = syntheticUser({ seed: 5, missing: 0.05 })
    for (let i = 0; i < days.length; i++) days[i].values.steps = 2000 + (i % 5) * 1500
    for (let i = 0; i < days.length - 1; i++) {
      const steps = days[i].values.steps!
      days[i + 1].values.sleepMinutes = 330 + Math.round((steps - 2000) / 1500) * 25 + (i % 3) * 5
    }
    const results = analyzeUser(days, { today: TODAY, loggedCycles: 0 })
    const r = find(results, 'steps->sleepMinutes:same-night')
    expect(passesNew(r)).toBe(true)
    expect(r.effect!).toBeGreaterThan(0)
    expect(r.rho!).toBeGreaterThan(0.9)
  })

  it('discounts a pattern that weekends alone explain', () => {
    // Long walks only on weekends, and more sleep on weekend nights,
    // with no link between the two within weekdays or within weekends
    const days = syntheticUser({ seed: 9, missing: 0 })
    days.forEach((d, i) => {
      const dow = new Date(`${d.date}T00:00:00Z`).getUTCDay()
      const weekend = dow === 0 || dow === 6
      d.values.steps = (weekend ? 9000 : 3000) + (i % 4) * 300
      // Sleep stored on D is the night before D: long after Saturday and Sunday
      const dowPrev = (dow + 6) % 7
      d.values.sleepMinutes = (dowPrev === 6 || dowPrev === 0 ? 480 : 380) + ((i * 7) % 5) * 10
    })
    const r = find(analyzeUser(days, { today: TODAY, loggedCycles: 0 }), 'steps->sleepMinutes:same-night')
    expect(r.effect!).toBeGreaterThan(30) // the raw difference looks meaningful
    expect(passesNew(r)).toBe(false) // but it is the weekend, not the walking
  })

  it('finds a planted cycle-phase pattern and labels the phase as the low group', () => {
    const days = syntheticUser({
      seed: 21,
      missing: 0.1,
      cycle: true,
      plant: (d) => {
        if (d.cyclePhase === 'luteal' && d.values.moodValue != null) d.values.moodValue = Math.max(1, d.values.moodValue - 2)
      },
    })
    const r = find(analyzeUser(days, { today: TODAY, loggedCycles: 3 }), 'cyclePhase:luteal->moodValue:same-day')
    expect(passesNew(r)).toBe(true)
    expect(r.phase).toBe('luteal')
    expect(r.meanLow!).toBeLessThan(r.meanHigh!)
  })

  it('skips cycle-phase tests for users with fewer than 2 logged periods', () => {
    const days = syntheticUser({ seed: 21, cycle: true })
    const results = analyzeUser(days, { today: TODAY, loggedCycles: 1 })
    expect(results.some((r) => r.kind === 'cycle')).toBe(false)
  })
})

describe('analyzeUser: noise', () => {
  it('rarely reports anything for users with no real patterns (false-positive rate ≤ 5%)', () => {
    // Synthetic users include weekend habits that move drivers and outcomes
    // together without any direct link; those must not be reported either
    const N = 300
    let usersWithAny = 0
    for (let s = 1; s <= N; s++) {
      const cycle = s % 2 === 0
      const days = syntheticUser({ seed: s * 7919, cycle })
      const results = analyzeUser(days, { today: TODAY, loggedCycles: cycle ? 3 : 0 })
      if (results.some((r) => passesNew(r))) usersWithAny++
    }
    expect(usersWithAny / N).toBeLessThanOrEqual(0.05)
  }, 300_000)
})

describe('analyzeUser: missing data', () => {
  it('never treats a missing value as 0', () => {
    // Stress is very high on days with no sleep logged. If missing sleep were
    // read as 0 hours, that would look like "short sleep → high stress".
    const days = syntheticUser({ seed: 3, missing: 0 })
    days.forEach((d, i) => {
      if (i % 3 === 0) {
        d.values.sleepMinutes = null
        d.values.stressScore = 10
      }
    })
    const r = find(analyzeUser(days, { today: TODAY, loggedCycles: 0 }), SLEEP_STRESS)
    const paired = days.filter((d) => d.values.sleepMinutes != null && d.values.stressScore != null).length
    expect(r.pairedDays).toBe(paired)
    expect(passesNew(r)).toBe(false)
  })

  it('does not test a pair with fewer than 14 paired days', () => {
    const days = syntheticUser({ seed: 4, missing: 0 })
    days.forEach((d, i) => { if (i >= 13) d.values.sleepMinutes = null })
    const r = find(analyzeUser(days, { today: TODAY, loggedCycles: 0 }), SLEEP_STRESS)
    expect(r.pairedDays).toBe(13)
    expect(r.testable).toBe(false)
    expect(r.q).toBeUndefined()
  })

  it('only uses the 90 days before today', () => {
    const days = syntheticUser({ seed: 6, days: 200, missing: 0 })
    const r = find(analyzeUser(days, { today: TODAY, loggedCycles: 0 }), SLEEP_STRESS)
    expect(r.pairedDays).toBe(INSIGHT_SETTINGS.windowDays)
  })

  it('counts focus + study as missing only when neither was logged', () => {
    const days = syntheticUser({ seed: 8, missing: 0 })
    days.forEach((d) => { d.values.focusMinutes = null; d.values.studyMinutes = null })
    days.slice(0, 20).forEach((d) => { d.values.studyMinutes = 30 })
    const r = find(analyzeUser(days, { today: TODAY, loggedCycles: 0 }), 'workMinutes->stressScore:same-day')
    expect(r.pairedDays).toBe(20)
  })
})

describe('show / keep / bring-back rules', () => {
  const base: TestResult = {
    key: SLEEP_STRESS, kind: 'pair', driver: 'sleepMinutes', outcome: 'stressScore', lag: 'same-day',
    pairedDays: 40, testable: true, nLow: 15, nHigh: 25, meanLow: 7, meanHigh: 5,
    effect: -2, adjusted: -2, strength: 1, rho: -0.5, rhoAdjusted: -0.5, p: 0.001, q: 0.01,
  }

  it('shows a strong, consistent result', () => {
    expect(passesNew(base)).toBe(true)
  })

  it('needs the minimum effect (stress: 1 point on 1–10)', () => {
    expect(passesNew({ ...base, effect: -0.8, adjusted: -0.8 })).toBe(false)
  })

  it('rejects results whose adjusted effect or correlation points the other way', () => {
    expect(passesNew({ ...base, adjusted: 0.5 })).toBe(false)
    expect(passesNew({ ...base, rhoAdjusted: 0.1 })).toBe(false)
  })

  it('keeps an active insight a little past the bar so it does not flicker', () => {
    const weaker = { ...base, q: 0.15, effect: -0.8, adjusted: -0.8 }
    expect(passesNew(weaker)).toBe(false)
    expect(passesKeep(weaker)).toBe(true)
    expect(passesKeep({ ...weaker, q: 0.25 })).toBe(false)
  })

  it('brings back a dismissed insight only when it is much stronger', () => {
    expect(passesReturn({ ...base, q: 0.005 }, -1.5)).toBe(false) // 2 < 1.5 × 1.5
    expect(passesReturn({ ...base, q: 0.005, effect: -2.4, adjusted: -2.4 }, -1.5)).toBe(true)
    expect(passesReturn({ ...base, q: 0.02, effect: -2.4, adjusted: -2.4 }, -1.5)).toBe(false)
  })

  it('never shows an untestable result', () => {
    expect(passesNew({ ...base, testable: false })).toBe(false)
  })
})
