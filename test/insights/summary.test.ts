import { describe, expect, it, vi } from 'vitest'
import type { FeatureDay } from '../../src/insights/analyze'
import { buildHealthSummary, type SummaryInput } from '../../src/insights/summary'
import { shareTokenParamsSchema } from '../../src/schemas/summary.schema'
import { hashToken, newToken } from '../../src/services/HealthSummaryService'
import { pdfSafe, renderSummaryPdf } from '../../src/services/SummaryPdf'
import { addDays } from '../../src/utils/day'

// HealthSummaryService loads the database client; vi.mock is hoisted above the imports
vi.mock('../../src/db/prisma', () => ({ prisma: {} }))

const TODAY = '2026-10-09'

function day(offsetFromToday: number, values: FeatureDay['values']): FeatureDay {
  return { date: addDays(TODAY, offsetFromToday), cyclePhase: null, cycleDay: null, values }
}

function input(patch: Partial<SummaryInput> = {}): SummaryInput {
  return {
    today: TODAY,
    months: 1,
    generatedAt: new Date('2026-10-09T08:00:00Z'),
    person: { name: 'Amina W.', dateOfBirth: new Date('2004-11-02T00:00:00Z'), gender: 'female' },
    days: [],
    periods: [],
    insights: [],
    flags: [],
    notes: null,
    ...patch,
  }
}

describe('buildHealthSummary', () => {
  it('covers the 30 or 91 days before today and states the disclaimer', () => {
    const s = buildHealthSummary(input())
    expect(s.period).toEqual({ from: '2026-09-09', to: '2026-10-08', months: 1, days: 30 })
    expect(buildHealthSummary(input({ months: 3 })).period.from).toBe('2026-07-10')
    expect(s.disclaimer).toBe('Self-tracked data from LivoraPulse. Not a diagnosis.')
    expect(s.sleep.weekly).toHaveLength(5)
    expect(buildHealthSummary(input({ months: 3 })).sleep.weekly).toHaveLength(13)
  })

  it('works out age on the day, and leaves out sex when not given', () => {
    expect(buildHealthSummary(input()).person).toEqual({ name: 'Amina W.', age: 21, sex: 'Female' }) // 22 on 2 Nov
    expect(buildHealthSummary(input({ person: { name: 'X', dateOfBirth: null, gender: null } })).person).toEqual({ name: 'X', age: null, sex: null })
  })

  it('summarises sleep with averages, short nights and the trend', () => {
    const days = [
      ...Array.from({ length: 10 }, (_, i) => day(-30 + i, { sleepMinutes: 420 })), // first half: 7h
      ...Array.from({ length: 10 }, (_, i) => day(-12 + i, { sleepMinutes: i < 5 ? 330 : 360 })), // second half: lower
    ]
    const s = buildHealthSummary(input({ days })).sleep
    expect(s.daysLogged).toBe(20)
    expect(s.average).toBeCloseTo((10 * 420 + 5 * 330 + 5 * 360) / 20)
    expect(s.min).toBe(330)
    expect(s.notableDays).toBe(5) // nights under 6h (360 itself is not under)
    expect(s.trend).toBe('lower')
    expect(s.text).toBe(
      'Logged on 20 of 30 nights. Average 6h 25m a night (range 5h 30m to 7h). 5 nights under 6h. Lower in the second half of the period than the first.',
    )
  })

  it('shows stress on the 1–5 scale the app uses', () => {
    const days = Array.from({ length: 12 }, (_, i) => day(-20 + i, { stressScore: i < 4 ? 8 : 4 }))
    const s = buildHealthSummary(input({ days })).stress
    expect(s.average).toBeCloseTo((4 * 4 + 8 * 2) / 12)
    expect(s.notableDays).toBe(4) // 8 stored = 4 shown = "high"
    expect(s.text).toContain('out of 5')
  })

  it('says when something was not logged, and gives no trend without enough data', () => {
    const s = buildHealthSummary(input({ days: [day(-3, { moodValue: 4 })] }))
    expect(s.sleep.text).toBe('Not logged in this period.')
    expect(s.walks.text).toBe('No walks recorded in this period.')
    expect(s.mood.trend).toBeNull()
    expect(s.mood.daysLogged).toBe(1)
  })

  it('makes clear walks are recorded walks, not all-day steps', () => {
    const s = buildHealthSummary(input({ days: [day(-2, { steps: 5000 }), day(-1, { steps: 6000 })] }))
    expect(s.walks.text).toBe('Walks recorded on 2 days, averaging 5,500 steps on those days. Counts recorded walks only, not all-day steps.')
  })

  it('ignores days outside the period', () => {
    const s = buildHealthSummary(input({ days: [day(-31, { moodValue: 1 }), day(0, { moodValue: 1 }), day(-1, { moodValue: 5 })] }))
    expect(s.mood.daysLogged).toBe(1)
    expect(s.mood.average).toBe(5)
  })
})

describe('buildHealthSummary: cycle', () => {
  const periods = [
    { startKey: '2026-07-20', periodDuration: 5, flowIntensity: 'medium', symptoms: ['cramps'] },
    { startKey: '2026-08-17', periodDuration: 5, flowIntensity: 'heavy', symptoms: ['cramps', 'fatigue'] }, // 28 days
    { startKey: '2026-09-25', periodDuration: 4, flowIntensity: 'medium', symptoms: ['cramps', 'headache'] }, // 39 days
  ]

  it('is left out for users who do not track their cycle', () => {
    expect(buildHealthSummary(input()).cycle).toBeNull()
  })

  it('reports lengths, the typical range, flow and symptoms as facts', () => {
    const c = buildHealthSummary(input({ months: 3, periods })).cycle!
    expect(c.periodsLogged).toBe(3)
    expect(c.lastPeriodStart).toBe('2026-09-25')
    expect(c.lengths).toEqual([28, 39]) // the cycle from 25 Sep hasn't ended
    expect(c.averageLength).toBe(34)
    expect(c.outsideTypicalRange).toBe(1)
    expect(c.flow).toEqual({ medium: 2, heavy: 1 })
    expect(c.symptoms[0]).toEqual({ name: 'cramps', count: 3 })
    expect(c.text).toBe(
      '3 periods logged; the last started on 25 Sep 2026. Cycle lengths: 28 and 39 days (average 34). ' +
        '1 cycle was outside the typical 21–35 day range. Flow: medium 2 and heavy 1. ' +
        'Symptoms logged: cramps (3), fatigue (1) and headache (1).',
    )
  })

  it('uses the next period after the window to measure the last cycle in it', () => {
    // 1 month: only 25 Sep is in range, and no later period exists yet
    const c = buildHealthSummary(input({ periods })).cycle!
    expect(c.periodsLogged).toBe(1)
    expect(c.lengths).toEqual([])
  })

  it('says so when tracking is on but nothing was logged in the period', () => {
    const c = buildHealthSummary(input({ periods: [periods[0]] })).cycle!
    expect(c.text).toBe('Cycle tracking is on, but no periods were logged in this period.')
  })
})

describe('buildHealthSummary: notes', () => {
  it('leaves notes out unless the user chose to include them', () => {
    expect(buildHealthSummary(input()).notes).toBeNull()
  })

  it('keeps notes from the period, newest first, shortened if very long', () => {
    const long = 'x'.repeat(400)
    const s = buildHealthSummary(input({
      notes: [
        { date: '2026-09-20', area: 'Mood', text: 'Exams this week' },
        { date: '2026-10-05', area: 'Cycle', text: long },
        { date: '2026-08-01', area: 'Mood', text: 'Too old' },
        { date: '2026-09-30', area: 'Mood', text: '   ' },
      ],
    }))
    expect(s.notes!.map((n) => n.date)).toEqual(['2026-10-05', '2026-09-20'])
    expect(s.notes![0].text).toHaveLength(300)
    expect(s.notes![0].text.endsWith('…')).toBe(true)
  })
})

describe('summary PDF', () => {
  const full = buildHealthSummary(input({
    months: 3,
    days: Array.from({ length: 60 }, (_, i) => day(-60 + i, { sleepMinutes: 400 + (i % 5) * 10, moodValue: 3 + (i % 3) * 0.5, stressScore: 4 + (i % 4), steps: i % 3 === 0 ? 5200 : null })),
    periods: [
      { startKey: '2026-08-01', periodDuration: 5, flowIntensity: 'medium', symptoms: ['cramps'] },
      { startKey: '2026-08-30', periodDuration: 5, flowIntensity: 'light', symptoms: [] },
    ],
    insights: ['After nights with under 6h of sleep, your stress that day averages 3.4 instead of 2.5 (out of 5). Based on 31 days.'],
  }))

  it('renders a one-page PDF', async () => {
    const pdf = await renderSummaryPdf(full)
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(1)
  })

  it('puts the notes on their own page', async () => {
    const pdf = await renderSummaryPdf({ ...full, notes: [{ date: '2026-09-20', area: 'Mood', text: 'Exams this week 😩' }] })
    expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(2)
  })

  it('keeps accented letters and drops what the built-in fonts cannot print', () => {
    expect(pdfSafe('Wanjirũ — café')).toBe('Wanjir? — café')
    expect(pdfSafe('Nimechoka 😩 sana')).toBe('Nimechoka  sana')
    expect(pdfSafe('Line one\nline two')).toBe('Line one\nline two')
  })
})

describe('share tokens', () => {
  it('are 43 URL-safe characters that pass validation', () => {
    const t = newToken()
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(shareTokenParamsSchema.safeParse({ token: t }).success).toBe(true)
    expect(newToken()).not.toBe(t)
  })

  it('are stored as a sha256 hash, never as-is', () => {
    const t = newToken()
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashToken(t)).toBe(hashToken(t))
    expect(hashToken(t)).not.toContain(t)
  })

  it('reject anything that is not a token', () => {
    for (const bad of ['', 'short', `${'a'.repeat(42)}/`, `${'a'.repeat(44)}`, '../../etc/passwd']) {
      expect(shareTokenParamsSchema.safeParse({ token: bad }).success).toBe(false)
    }
  })
})
