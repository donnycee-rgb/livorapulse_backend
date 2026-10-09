import { describe, expect, it } from 'vitest'
import { addDays, dayBounds, dayKey, startOfDay } from '../src/utils/day'

describe('day helpers (Africa/Nairobi)', () => {
  it('puts 01:00 Nairobi in the local day, not the previous UTC day', () => {
    // 2026-03-10 01:00 in Nairobi is 2026-03-09 22:00 UTC
    expect(dayKey(new Date('2026-03-09T22:00:00Z'))).toBe('2026-03-10')
  })

  it('starts a local day at 21:00 UTC the evening before', () => {
    expect(startOfDay('2026-03-10').toISOString()).toBe('2026-03-09T21:00:00.000Z')
  })

  it('gives 24-hour bounds', () => {
    const { start, end } = dayBounds('2026-03-10')
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000)
  })

  it('shifts keys across month ends', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
})
