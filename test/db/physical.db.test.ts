import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/App'
import { prisma } from '../../src/db/prisma'
import { computeDailyScore } from '../../src/services/ScoreService'
import { dayBounds } from '../../src/utils/day'
import { signAccessToken } from '../../src/utils/jwt'

// Sleep (last night vs naps) and other activities, through the real route

type U = { id: string; email: string }
let app: FastifyInstance
let me: U
const auth = (u: U) => ({ authorization: `Bearer ${signAccessToken({ id: u.id, email: u.email })}` })
const post = (payload: object) => app.inject({ method: 'POST', url: '/api/activity/physical', headers: auth(me), payload })
const base = { steps: 0, distanceKm: 0, caloriesKcal: 0, sleepMinutes: 0 }

async function todaysEntries() {
  const { start, end } = dayBounds(new Date())
  return prisma.physicalActivityEntry.findMany({ where: { userId: me.id, timestamp: { gte: start, lt: end } } })
}

beforeAll(async () => {
  app = await buildApp()
  me = await prisma.user.create({
    data: { name: 'sleeper', email: `sleeper-${Date.now()}@example.test`, profile: { create: { onboardingComplete: true, weightKg: 80 } } },
  })
})

afterAll(async () => {
  await prisma.user.delete({ where: { id: me.id } })
  await app.close()
  await prisma.$disconnect()
})

describe('sleep: last night and naps', () => {
  it('a nap adds to last night instead of replacing it', async () => {
    expect((await post({ ...base, sleepMinutes: 300, sleepType: 'night' })).statusCode).toBe(201)
    expect((await post({ ...base, sleepMinutes: 120, sleepType: 'nap' })).statusCode).toBe(201)
    const total = (await todaysEntries()).reduce((s, e) => s + e.sleepMinutes, 0)
    expect(total).toBe(420)
  })

  it('setting last night again corrects it, and keeps the nap', async () => {
    expect((await post({ ...base, sleepMinutes: 360, sleepType: 'night' })).statusCode).toBe(200)
    const entries = (await todaysEntries()).filter((e) => e.sleepMinutes > 0)
    expect(entries.filter((e) => e.sleepType === 'night').map((e) => e.sleepMinutes)).toEqual([360])
    expect(entries.filter((e) => e.sleepType === 'nap').map((e) => e.sleepMinutes)).toEqual([120])
  })

  it('sleep sent without a type is last night (older app versions)', async () => {
    expect((await post({ ...base, sleepMinutes: 390 })).statusCode).toBe(200)
    const nights = (await todaysEntries()).filter((e) => e.sleepType === 'night')
    expect(nights.map((e) => e.sleepMinutes)).toEqual([390])
  })
})

describe('other activities', () => {
  it('the server works out calories and step credit, ignoring a typed calorie number', async () => {
    const res = await post({ ...base, caloriesKcal: 9999, activityType: 'football', durationMin: 30, note: 'Weekend match' })
    expect(res.statusCode).toBe(201)
    const data = res.json().data
    // football 7 MET: (7 - 1) × 80 kg × 0.5 h = 240 kcal; vigorous: 30 min × 200 steps
    expect(data.caloriesKcal).toBe(240)
    expect(data.stepEquivalent).toBe(6000)
    expect(data.durationMin).toBe(30)
  })

  it('rejects an activity without a duration, or an unknown activity', async () => {
    expect((await post({ ...base, activityType: 'football' })).statusCode).toBe(400)
    expect((await post({ ...base, activityType: 'teleporting', durationMin: 10 })).statusCode).toBe(400)
  })

  it('counts toward the physical score through its step credit', async () => {
    const result = await computeDailyScore(me.id)
    // 6,000 credited steps of an 8,000 goal → steps part 75 of 100
    expect(result.components.physical).toBeGreaterThan(50)
  })
})

describe('sleep logged with times', () => {
  const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString()

  it('works out the minutes from bedtime and wake-up, and corrects last night', async () => {
    const res = await post({ ...base, sleepMinutes: 1, sleepType: 'night', sleepStart: ago(450), sleepEnd: ago(5) })
    expect(res.statusCode).toBe(200) // last night already existed today: corrected, not added
    expect(res.json().data).toMatchObject({ sleepMinutes: 445, sleepStart: expect.any(String), sleepEnd: expect.any(String) })
    const nights = (await todaysEntries()).filter((e) => e.sleepType === 'night')
    expect(nights).toHaveLength(1)
    expect(nights[0].sleepMinutes).toBe(445)
    expect(nights[0].sleepStart).toBeInstanceOf(Date)
  })

  it('a nap with times adds, and counts for the time it ended', async () => {
    const before = (await todaysEntries()).length
    const res = await post({ ...base, sleepMinutes: 0, sleepType: 'nap', sleepStart: ago(40), sleepEnd: ago(10) })
    expect(res.statusCode).toBe(201)
    expect(res.json().data.sleepMinutes).toBe(30)
    expect((await todaysEntries()).length).toBe(before + 1)
  })

  it('refuses times that make no sense', async () => {
    expect((await post({ ...base, sleepType: 'night', sleepStart: ago(10), sleepEnd: ago(60) })).statusCode).toBe(400) // ends before it starts
    expect((await post({ ...base, sleepType: 'night', sleepStart: ago(60) })).statusCode).toBe(400) // only one time
    expect((await post({ ...base, sleepType: 'nap', sleepStart: ago(5), sleepEnd: ago(2) })).statusCode).toBe(400) // 3 minutes
    expect((await post({ ...base, sleepType: 'night', sleepStart: ago(30), sleepEnd: new Date(Date.now() + 3 * 3600000).toISOString() })).statusCode).toBe(400) // future
    expect((await post({ ...base, sleepType: 'night', sleepStart: ago(25 * 60), sleepEnd: ago(1) })).statusCode).toBe(400) // over 20 hours
  })
})
