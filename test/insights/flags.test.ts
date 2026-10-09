import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FeatureDay } from '../../src/insights/analyze'
import {
  cycleLengthFlag,
  evaluateFlags,
  heavyFlowFlag,
  lowMoodFlag,
  missedPeriodFlag,
  shortSleepFlag,
  type FlagPeriod,
} from '../../src/insights/flags'
import { describeFlag, SUPPORT_CONTACTS, verifiedContacts } from '../../src/insights/wording'
import { flagsEnabled, toFlagView } from '../../src/services/FlagService'
import { addDays } from '../../src/utils/day'

// FlagService loads the database client; vi.mock is hoisted above the imports
vi.mock('../../src/db/prisma', () => ({ prisma: {} }))

const TODAY = '2026-10-10'

/** Days before today (1 = yesterday) mapped to values */
function days(values: (i: number) => FeatureDay['values'], count = 28): Map<string, FeatureDay> {
  const m = new Map<string, FeatureDay>()
  for (let i = 1; i <= count; i++) {
    const date = addDays(TODAY, -i)
    m.set(date, { date, cyclePhase: null, cycleDay: null, values: values(i) })
  }
  return m
}

const periodsFrom = (starts: string[], flow: (string | null)[] = []): FlagPeriod[] =>
  starts.map((startKey, i) => ({ startKey, flowIntensity: flow[i] ?? null }))

describe('low mood', () => {
  it('flags mostly-low moods across both of the last 2 weeks', () => {
    const f = lowMoodFlag(days((i) => ({ moodValue: i % 4 === 0 ? 3 : 2 })), TODAY)
    expect(f?.key).toBe('low-mood')
    expect(f?.evidence).toMatchObject({ loggedDays: 14, lowDays: 11 })
  })

  it('does not flag one bad week', () => {
    // Last week low, the week before fine
    expect(lowMoodFlag(days((i) => ({ moodValue: i <= 7 ? 1 : 4 })), TODAY)).toBeNull()
  })

  it('does not flag exactly half low ("most" means more than half)', () => {
    expect(lowMoodFlag(days((i) => ({ moodValue: i % 2 === 0 ? 2 : 4 }), 14), TODAY)).toBeNull()
  })

  it('needs at least 3 check-ins in each week', () => {
    // Only 2 check-ins in the older week, both low
    expect(lowMoodFlag(days((i) => (i <= 7 || i === 9 || i === 12 ? { moodValue: 1 } : {})), TODAY)).toBeNull()
  })

  it('treats a missing day as missing, not as low', () => {
    const f = lowMoodFlag(days((i) => (i % 2 === 0 ? { moodValue: 1 } : {})), TODAY)
    expect(f?.evidence).toMatchObject({ loggedDays: 7, lowDays: 7 })
  })
})

describe('short sleep', () => {
  it('flags most nights under 6 h in each of the last 3 weeks', () => {
    const f = shortSleepFlag(days((i) => ({ sleepMinutes: i % 3 === 0 ? 420 : 330 })), TODAY)
    expect(f?.key).toBe('short-sleep')
    expect(f?.evidence).toMatchObject({ loggedNights: 21, shortNights: 14 })
  })

  it('does not flag 2 short weeks followed by a good one', () => {
    expect(shortSleepFlag(days((i) => ({ sleepMinutes: i <= 7 ? 450 : 300 })), TODAY)).toBeNull()
  })

  it('does not count exactly 6 h as short', () => {
    expect(shortSleepFlag(days(() => ({ sleepMinutes: 360 })), TODAY)).toBeNull()
  })
})

describe('cycle length', () => {
  it('flags when 2 of the last 3 cycles were outside 21–35 days', () => {
    const p = periodsFrom(['2026-04-01', '2026-05-10', '2026-06-06', '2026-07-20']) // 39, 27, 44
    const f = cycleLengthFlag(p, TODAY)
    expect(f?.evidence).toMatchObject({ lengths: [39, 27, 44], outside: 2 })
  })

  it('does not flag a single long cycle', () => {
    const p = periodsFrom(['2026-04-01', '2026-05-10', '2026-06-06', '2026-07-04']) // 39, 27, 28
    expect(cycleLengthFlag(p, TODAY)).toBeNull()
  })

  it('needs 3 finished cycles', () => {
    expect(cycleLengthFlag(periodsFrom(['2026-06-01', '2026-07-20', '2026-09-05']), TODAY)).toBeNull()
  })
})

describe('missed period', () => {
  it('flags 60+ days since the last logged period for someone tracking', () => {
    const f = missedPeriodFlag(periodsFrom(['2026-06-10', '2026-07-08']), TODAY) // 94 days
    expect(f?.evidence).toMatchObject({ daysSince: 94, lastStart: '2026-07-08' })
  })

  it('does not flag under 60 days', () => {
    expect(missedPeriodFlag(periodsFrom(['2026-07-20', '2026-08-17']), TODAY)).toBeNull() // 54 days
  })

  it('does not flag someone who stopped tracking long ago', () => {
    expect(missedPeriodFlag(periodsFrom(['2026-01-01', '2026-01-29']), TODAY)).toBeNull()
  })

  it('does not flag someone who has logged only one period', () => {
    expect(missedPeriodFlag(periodsFrom(['2026-07-08']), TODAY)).toBeNull()
  })
})

describe('heavy flow', () => {
  it('flags heavy flow on 3 of the last 4 periods', () => {
    const p = periodsFrom(['2026-06-01', '2026-06-29', '2026-07-27', '2026-08-24'], ['heavy', 'medium', 'heavy', 'heavy'])
    expect(heavyFlowFlag(p, TODAY)?.evidence).toMatchObject({ heavyPeriods: 3, periods: 4 })
  })

  it('does not flag 2 heavy periods', () => {
    const p = periodsFrom(['2026-06-01', '2026-06-29', '2026-07-27', '2026-08-24'], ['heavy', 'medium', 'light', 'heavy'])
    expect(heavyFlowFlag(p, TODAY)).toBeNull()
  })

  it('ignores periods logged without a flow', () => {
    const p = periodsFrom(['2026-06-01', '2026-06-29', '2026-07-27'], ['heavy', null, 'heavy'])
    expect(heavyFlowFlag(p, TODAY)).toBeNull()
  })
})

describe('evaluateFlags', () => {
  it('raises nothing for an ordinary month', () => {
    const d = [...days((i) => ({ moodValue: 3 + (i % 2), sleepMinutes: 420 + (i % 3) * 20 })).values()]
    const p = periodsFrom(['2026-07-15', '2026-08-12', '2026-09-09', '2026-10-07'], ['medium', 'heavy', 'medium', 'light'])
    expect(evaluateFlags({ today: TODAY, days: d, periods: p })).toEqual([])
  })
})

describe('flag wording', () => {
  const evidence: Record<string, Record<string, number | string | number[]>> = {
    'low-mood': { lowDays: 11, loggedDays: 14, weeks: 2 },
    'short-sleep': { shortNights: 14, loggedNights: 21, averageMinutes: 340, weeks: 3 },
    'cycle-length': { lengths: [39, 27, 44], outside: 2, typicalMin: 21, typicalMax: 35 },
    'missed-period': { daysSince: 94, lastStart: '2026-07-08' },
    'heavy-flow': { heavyPeriods: 3, periods: 4 },
  }

  it('gives every flag a title, a message, a reason and a next step', () => {
    for (const [key, e] of Object.entries(evidence)) {
      const c = describeFlag(key, e)
      expect(c.title.length).toBeGreaterThan(5)
      expect(c.message.length).toBeGreaterThan(40)
      expect(c.why.length).toBeGreaterThan(20)
      expect(c.actions.length).toBeGreaterThan(0)
    }
  })

  it('never diagnoses or alarms', () => {
    for (const [key, e] of Object.entries(evidence)) {
      const c = describeFlag(key, e)
      // Saying it *isn't* a diagnosis is the point; anything else diagnostic or alarming is not allowed
      const text = `${c.title} ${c.message} ${c.why}`.replace("isn't a diagnosis", '')
      expect(text).not.toMatch(/diagnos|depress|disorder|disease|urgent|danger|warning|abnormal|you have /i)
    }
  })

  it('states the numbers it is based on', () => {
    expect(describeFlag('low-mood', evidence['low-mood']).message).toContain('11 of the 14 days')
    expect(describeFlag('cycle-length', evidence['cycle-length']).message).toContain('39, 27 and 44 days')
    expect(describeFlag('missed-period', evidence['missed-period']).message).toContain('8 Jul 2026, 94 days ago')
  })
})

describe('support contacts', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('are all unverified until checked, so none are shown yet', () => {
    expect(SUPPORT_CONTACTS.every((c) => c.verified === false)).toBe(true)
    expect(verifiedContacts()).toEqual([])
  })

  it('only ever appear on flags that offer support', () => {
    const row = { id: 'f1', userId: 'u1', status: 'active', firstRaisedAt: new Date(), lastSeenAt: new Date(), dismissedAt: null, updatedAt: new Date() }
    expect(toFlagView({ ...row, key: 'low-mood', evidence: { lowDays: 9, loggedDays: 12, weeks: 2 } }).actions).toContain('support')
    expect(toFlagView({ ...row, key: 'heavy-flow', evidence: { heavyPeriods: 3, periods: 4 } }).contacts).toEqual([])
  })

  it('flags are off unless switched on', () => {
    vi.stubEnv('HEALTH_FLAGS_ENABLED', '')
    expect(flagsEnabled()).toBe(false)
    vi.stubEnv('HEALTH_FLAGS_ENABLED', 'true')
    expect(flagsEnabled()).toBe(true)
  })
})
