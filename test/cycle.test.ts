import { describe, expect, it } from 'vitest'
import { addDaysKey, calendarMarks, cycleLengths, cycleStats, cycleStatus, groupPeriods, type PeriodDayInput } from '../src/utils/cycle'

const day = (date: string, flow: string | null = 'medium', symptoms: string[] = []): PeriodDayInput => ({ date, flow, symptoms, notes: null })
/** A period of `n` days starting `start` */
const period = (start: string, n: number, flow = 'medium') => Array.from({ length: n }, (_, i) => day(addDaysKey(start, i), flow))

describe('periods from logged days', () => {
  it('a run of days is one period, with its real length', () => {
    const p = groupPeriods(period('2026-10-01', 4))
    expect(p).toHaveLength(1)
    expect(p[0]).toMatchObject({ start: '2026-10-01', end: '2026-10-04', days: 4 })
  })

  it('one missed day inside a period does not split it; a longer gap does', () => {
    expect(groupPeriods([day('2026-10-01'), day('2026-10-03')])).toHaveLength(1)
    expect(groupPeriods([day('2026-10-01'), day('2026-10-05')])).toHaveLength(2)
  })

  it('keeps the heaviest flow and every symptom', () => {
    const p = groupPeriods([day('2026-10-01', 'light', ['Cramps']), day('2026-10-02', 'heavy', ['Fatigue', 'Cramps'])])[0]
    expect(p.heaviestFlow).toBe('heavy')
    expect(p.symptoms).toEqual(['Cramps', 'Fatigue'])
  })

  it('logged out of order (backfilled), cycles still come out right', () => {
    const days = [...period('2026-10-29', 5), ...period('2026-09-01', 5), ...period('2026-10-01', 5)]
    expect(cycleLengths(groupPeriods(days))).toEqual([30, 28])
  })

  it('logging the same day twice is still one day (the store keeps one row per day)', () => {
    expect(groupPeriods([day('2026-10-01'), day('2026-10-01')])[0].days).toBe(1)
  })
})

describe('averages and predictions', () => {
  const regular = [...period('2026-07-01', 5), ...period('2026-07-29', 5), ...period('2026-08-26', 5), ...period('2026-09-23', 5), ...period('2026-10-21', 5)]

  it('real averages, with a narrow range for regular cycles', () => {
    const s = cycleStats(groupPeriods(regular), '2026-11-01', { cycleLength: 31, periodLength: 7 })
    expect(s).toMatchObject({ cycleLength: 28, periodLength: 5, spread: 1 })
  })

  it("falls back to the person's settings, with a wider range, until there's history", () => {
    const s = cycleStats(groupPeriods(period('2026-10-21', 5)), '2026-11-01', { cycleLength: 31, periodLength: 6 })
    expect(s).toMatchObject({ cycleLength: 31, periodLength: 5, spread: 3, cyclesUsed: 0 })
  })

  it('irregular cycles give a wider range', () => {
    const irregular = [...period('2026-05-01', 5), ...period('2026-05-25', 5), ...period('2026-06-29', 5), ...period('2026-07-24', 5), ...period('2026-08-30', 5)]
    expect(cycleStats(groupPeriods(irregular), '2026-09-10', {}).spread).toBeGreaterThanOrEqual(4)
  })

  it('status: day of cycle, phase and the next period range', () => {
    const periods = groupPeriods(regular)
    const s = cycleStats(periods, '2026-11-01', {})
    const st = cycleStatus(periods, s, '2026-11-01')!
    expect(st).toMatchObject({ dayOfCycle: 12, phase: 'follicular', nextPeriodDate: '2026-11-18', nextPeriodEarliest: '2026-11-17', nextPeriodLatest: '2026-11-19', isLate: false })
  })

  it('late only after the latest date in the range', () => {
    const periods = groupPeriods(regular)
    const s = cycleStats(periods, '2026-11-01', {})
    expect(cycleStatus(periods, s, '2026-11-19')!.isLate).toBe(false)
    expect(cycleStatus(periods, s, '2026-11-21')).toMatchObject({ isLate: true, daysLate: 2 })
  })

  it('calendar: logged days, then predictions only from today on', () => {
    const periods = groupPeriods(regular)
    const s = cycleStats(periods, '2026-11-01', {})
    const logged = new Set(regular.map((d) => d.date))
    const marks = calendarMarks(periods, s, logged, '2026-10-01', '2026-11-30', '2026-11-01')
    expect(marks['2026-10-22']).toBe('period')
    expect(marks['2026-11-18']).toBe('predicted-period')
    expect(marks['2026-11-04']).toBe('ovulation') // 14 days before 18 Nov
    expect(marks['2026-10-07']).toBeUndefined() // past cycles stay plain
  })
})
