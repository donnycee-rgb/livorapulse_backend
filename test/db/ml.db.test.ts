import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/App'
import { prisma } from '../../src/db/prisma'
import { addDays, dayKey, startOfDay } from '../../src/utils/day'
import { signAccessToken } from '../../src/utils/jwt'

// GET /api/ml/mood: reads what the nightly Python job wrote

type U = { id: string; email: string }
let app: FastifyInstance
let me: U
let other: U
const today = dayKey()
const get = (user: U | null) =>
  app.inject({ method: 'GET', url: '/api/ml/mood', headers: user ? { authorization: `Bearer ${signAccessToken({ id: user.id, email: user.email })}` } : {} })

const effect = (userId: string, feature: string, mean: number, sd: number, claim: string) => ({
  userId, outcome: 'mood', feature, unit: `1 unit of ${feature}`, mean, sd, probPositive: mean > 0 ? 0.97 : 0.03,
  ownShare: 0.6, claim, nDays: 21, modelVersion: 'mood-hbr-1',
})

beforeAll(async () => {
  app = await buildApp()
  const mk = (name: string) => prisma.user.create({ data: { name, email: `${name}-ml-${Date.now()}@example.test` } })
  me = await mk('me')
  other = await mk('other')

  await prisma.mlUserEffect.createMany({
    data: [
      effect(me.id, 'stepsK', 0.03, 0.02, 'typical'),
      effect(me.id, 'socialHours', -0.12, 0.04, 'personal'),
      effect(me.id, 'sleepHours', 0.3, 0.08, 'personal'),
      effect(me.id, 'waterGlasses', 0.01, 0.02, 'unclear'),
      effect(other.id, 'sleepHours', 0.5, 0.1, 'personal'),
    ],
  })
  await prisma.mlPrediction.createMany({
    data: [
      { userId: me.id, date: startOfDay(today), outcome: 'mood', mean: 3.6, lower: 2.9, upper: 4.3, nDays: 21, modelVersion: 'mood-hbr-1' },
      { userId: me.id, date: startOfDay(addDays(today, -1)), outcome: 'mood', mean: 2.1, lower: 1.5, upper: 2.8, nDays: 20, modelVersion: 'mood-hbr-1' },
    ],
  })
  await prisma.mlModelRun.create({ data: { modelVersion: 'mood-hbr-1', status: 'succeeded', finishedAt: new Date() } })
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [me.id, other.id] } } })
  await prisma.mlModelRun.deleteMany({})
  await app.close()
  await prisma.$disconnect()
})

describe('GET /api/ml/mood', () => {
  it('needs a signed-in user', async () => {
    expect((await get(null)).statusCode).toBe(401)
  })

  it("returns only this user's clear patterns, personal ones first", async () => {
    const { data } = (await get(me)).json()
    expect(data.effects.map((e: { feature: string }) => e.feature)).toEqual(['sleepHours', 'socialHours', 'stepsK'])
    expect(data.effects.every((e: { claim: string }) => e.claim !== 'unclear')).toBe(true)
    expect(data.moodDays).toBe(21)
    expect(data.minMoodDays).toBe(5)
  })

  it("gives today's forecast, not an older one", async () => {
    const { data } = (await get(me)).json()
    expect(data.forecast).toEqual({ date: today, mean: 3.6, lower: 2.9, upper: 4.3 })
    expect(data.lastRun.status).toBe('succeeded')
  })

  it('is empty for someone the model has nothing on yet', async () => {
    await prisma.mlUserEffect.deleteMany({ where: { userId: other.id } })
    const { data } = (await get(other)).json()
    expect(data.effects).toEqual([])
    expect(data.forecast).toBeNull()
    expect(data.moodDays).toBe(0)
  })
})
