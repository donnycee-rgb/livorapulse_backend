import { describe, expect, it } from 'vitest'
import { bedtimeDue, isTimeZone, localClock, wakeDue, type ReminderState } from '../src/utils/reminders'

// Nairobi is UTC+3 all year
const nbo = (local: string) => new Date(`${local}+03:00`)
const base: ReminderState = { timezone: 'Africa/Nairobi', bedtimeMinutes: 22 * 60 + 30, wakeReminder: true, sleepStartedAt: null, bedtimeSentOn: null, wakeSentFor: null }

describe('local time', () => {
  it('reads the clock in the person\'s own time zone', () => {
    expect(localClock(new Date('2026-11-20T19:30:00Z'), 'Africa/Nairobi')).toEqual({ date: '2026-11-20', minutes: 22 * 60 + 30 })
    expect(localClock(new Date('2026-11-20T19:30:00Z'), 'Africa/Lagos')).toEqual({ date: '2026-11-20', minutes: 20 * 60 + 30 })
  })
  it('knows real time zones', () => {
    expect(isTimeZone('Africa/Kampala')).toBe(true)
    expect(isTimeZone('Mars/Olympus')).toBe(false)
  })
})

describe('bedtime reminder', () => {
  it('goes at the chosen time, once a night', () => {
    expect(bedtimeDue(base, nbo('2026-11-20T22:20:00'))).toBeNull() // too early
    expect(bedtimeDue(base, nbo('2026-11-20T22:30:00'))).toBe('2026-11-20')
    expect(bedtimeDue(base, nbo('2026-11-20T22:45:00'))).toBe('2026-11-20') // a late run still sends
    expect(bedtimeDue({ ...base, bedtimeSentOn: '2026-11-20' }, nbo('2026-11-20T22:35:00'))).toBeNull() // already sent
    expect(bedtimeDue(base, nbo('2026-11-20T23:00:00'))).toBeNull() // window passed
  })
  it('not when off, or when they already went to sleep', () => {
    expect(bedtimeDue({ ...base, bedtimeMinutes: null }, nbo('2026-11-20T22:30:00'))).toBeNull()
    expect(bedtimeDue({ ...base, sleepStartedAt: nbo('2026-11-20T22:00:00') }, nbo('2026-11-20T22:30:00'))).toBeNull()
  })
  it('a bedtime just before midnight belongs to that night', () => {
    const late = { ...base, bedtimeMinutes: 23 * 60 + 55 }
    expect(bedtimeDue(late, nbo('2026-11-21T00:05:00'))).toBe('2026-11-20')
    expect(bedtimeDue({ ...late, bedtimeSentOn: '2026-11-20' }, nbo('2026-11-21T00:05:00'))).toBeNull()
  })
})

describe('morning reminder', () => {
  const asleep = { ...base, sleepStartedAt: nbo('2026-11-20T22:40:00') }
  it('after 7½ hours asleep, in the morning, once per sleep', () => {
    expect(wakeDue(asleep, nbo('2026-11-21T05:30:00'))).toBe(false) // only 6h 50m
    expect(wakeDue(asleep, nbo('2026-11-21T06:15:00'))).toBe(true)
    expect(wakeDue({ ...asleep, wakeSentFor: asleep.sleepStartedAt }, nbo('2026-11-21T07:00:00'))).toBe(false)
  })
  it('waits for the morning, and gives up on a tap forgotten long ago', () => {
    const early = { ...base, sleepStartedAt: nbo('2026-11-20T20:00:00') }
    expect(wakeDue(early, nbo('2026-11-21T04:00:00'))).toBe(false) // 8h, but 04:00
    expect(wakeDue(early, nbo('2026-11-21T05:00:00'))).toBe(true)
    expect(wakeDue(asleep, nbo('2026-11-22T07:00:00'))).toBe(false) // 32 hours
  })
  it('not when switched off or nothing is running', () => {
    expect(wakeDue({ ...asleep, wakeReminder: false }, nbo('2026-11-21T07:00:00'))).toBe(false)
    expect(wakeDue(base, nbo('2026-11-21T07:00:00'))).toBe(false)
  })
})
