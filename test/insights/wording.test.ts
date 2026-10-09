import { describe, expect, it } from 'vitest'
import type { TestResult } from '../../src/insights/analyze'
import { describeInsight, displayValue, formatMinutes, progressMessage } from '../../src/insights/wording'

const base: TestResult = {
  key: 'k', kind: 'pair', driver: 'sleepMinutes', outcome: 'stressScore', lag: 'same-day',
  pairedDays: 31, testable: true, split: { value: 360, mode: 'below', source: 'threshold' },
  nLow: 10, nHigh: 21, meanLow: 7.6, meanHigh: 5.8, effect: -1.8, adjusted: -1.6, strength: 1, rho: -0.4, p: 0.001, q: 0.01,
}

describe('formatMinutes', () => {
  it('reads like the app does', () => {
    expect(formatMinutes(45)).toBe('45 min')
    expect(formatMinutes(360)).toBe('6h')
    expect(formatMinutes(95)).toBe('1h 35m')
  })
})

describe('describeInsight', () => {
  it('writes sleep → stress on the 1–5 scale the user sees, with the evidence', () => {
    const c = describeInsight(base)
    expect(c.text).toBe('After nights with under 6h of sleep, your stress that day averages 3.8 instead of 2.9 (out of 5). Based on 31 days.')
    expect(c.groupLabelLow).toBe('Under 6h sleep')
    expect(c.groupLabelHigh).toBe('6h+ sleep')
    expect(displayValue('stressScore', 7.6)).toBe(3.8)
  })

  it('says "the next day" for next-day pairs', () => {
    const c = describeInsight({ ...base, driver: 'workMinutes', lag: 'next-day', split: { value: 150, mode: 'below', source: 'median' } })
    expect(c.text).toContain('On days with under 2h 30m of focus and study time, your stress the next day averages')
  })

  it('describes focus as a percentage', () => {
    const c = describeInsight({
      ...base, driver: 'socialMinutes', outcome: 'focusMinutes', split: { value: 120, mode: 'below', source: 'threshold' },
      meanLow: 70, meanHigh: 50, pairedDays: 19,
    })
    expect(c.text).toBe('On days with under 2h of social media, your focus time is about 40% longer (1h 10m instead of 50 min). Based on 19 days.')
  })

  it('describes same-night sleep after screen time', () => {
    const c = describeInsight({
      ...base, driver: 'screenMinutes', outcome: 'sleepMinutes', lag: 'same-night', split: { value: 200, mode: 'atOrBelow', source: 'median' },
      meanLow: 450, meanHigh: 400,
    })
    expect(c.text).toBe('On days you log 3h 20m or less of screen time, you sleep 7h 30m that night instead of 6h 40m. Based on 31 days.')
    expect(c.groupLabelHigh).toBe('Over 3h 20m screen time')
  })

  it('handles "no eco actions" naturally', () => {
    const c = describeInsight({ ...base, driver: 'ecoActions', outcome: 'moodValue', split: { value: 1, mode: 'below', source: 'median' }, meanLow: 3.2, meanHigh: 3.9 })
    expect(c.text).toContain('On days with no eco actions, your mood averages 3.2 instead of 3.9 (out of 5)')
    expect(c.groupLabelLow).toBe('No eco actions')
  })

  it('reassures only when the cycle phase is the harder stretch', () => {
    const harder = describeInsight({ ...base, kind: 'cycle', driver: 'cyclePhase', outcome: 'moodValue', phase: 'luteal', split: undefined, meanLow: 3.1, meanHigh: 3.8, pairedDays: 40 })
    expect(harder.text).toBe("In your luteal phase, your mood averages 3.1 out of 5, compared with 3.8 in the rest of your cycle. That's a pattern, not a bad week. Based on 40 days.")
    expect(harder.groupLabelLow).toBe('Luteal phase')
    expect(harder.groupLabelHigh).toBe('Rest of cycle')

    const easier = describeInsight({ ...base, kind: 'cycle', driver: 'cyclePhase', outcome: 'moodValue', phase: 'follicular', split: undefined, meanLow: 4.1, meanHigh: 3.5 })
    expect(easier.text).not.toContain('not a bad week')
  })

  it('never claims causation', () => {
    const texts = [
      describeInsight(base).text,
      describeInsight({ ...base, driver: 'steps', outcome: 'moodValue', split: { value: 5200, mode: 'below', source: 'median' }, meanLow: 3, meanHigh: 3.6 }).text,
    ]
    texts.forEach((t) => expect(t).not.toMatch(/caus|because|makes you/i))
  })
})

describe('progressMessage', () => {
  it('tells new users what to log', () => {
    expect(progressMessage('sleepMinutes', 'moodValue', 9)).toBe('Log sleep and mood on 9 more days to unlock your first insights.')
    expect(progressMessage('sleepMinutes', 'moodValue', 1)).toBe('Log sleep and mood on 1 more day to unlock your first insights.')
  })
})
