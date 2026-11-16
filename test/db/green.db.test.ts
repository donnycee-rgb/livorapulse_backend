import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/App'
import { prisma } from '../../src/db/prisma'
import { computeDailyScore } from '../../src/services/ScoreService'
import { signAccessToken } from '../../src/utils/jwt'

// Green habits and trips through the real route

type U = { id: string; email: string }
let app: FastifyInstance
let me: U
let other: U
const auth = (u: U) => ({ authorization: `Bearer ${signAccessToken({ id: u.id, email: u.email })}` })
const post = (u: U, payload: object) => app.inject({ method: 'POST', url: '/api/eco', headers: auth(u), payload })

beforeAll(async () => {
  app = await buildApp()
  const mk = (n: string) => prisma.user.create({ data: { name: n, email: `${n}-${Date.now()}@example.test`, profile: { create: { onboardingComplete: true, goalEcoActionsPerDay: 3 } } } })
  me = await mk('green')
  other = await mk('other-green')
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [me.id, other.id] } } })
  await app.close()
  await prisma.$disconnect()
})

describe('habits', () => {
  it('count once a day however many times they are ticked', async () => {
    const first = await post(me, { kind: 'habit', habit: 'bag' })
    const again = await post(me, { kind: 'habit', habit: 'bag' })
    expect(first.statusCode).toBe(201)
    expect(again.statusCode).toBe(200)
    expect(again.json().data.id).toBe(first.json().data.id)
    expect(await prisma.ecoAction.count({ where: { userId: me.id, category: 'HABIT', type: 'bag' } })).toBe(1)
  })

  it('carry no CO₂ number', async () => {
    const res = await post(me, { kind: 'habit', habit: 'power' })
    expect(res.json().data.impactKgCO2).toBe(0)
  })

  it('refuse unknown habits and typed CO₂', async () => {
    expect((await post(me, { kind: 'habit', habit: 'flew-less' })).statusCode).toBe(400)
    expect((await post(me, { category: 'WASTE', type: 'Recycled', impactKgCO2: 50 })).statusCode).toBe(400)
  })
})

describe('trips', () => {
  it('the server works out CO₂ avoided from how and how far', async () => {
    const res = await post(me, { kind: 'trip', mode: 'walk', distanceKm: 2 })
    expect(res.statusCode).toBe(201)
    expect(res.json().data).toMatchObject({ category: 'TRANSPORT', type: 'walk', distanceKm: 2, impactKgCO2: 0.34 })
  })

  it('a car trip avoids nothing', async () => {
    const res = await post(me, { kind: 'trip', mode: 'car', distanceKm: 8 })
    expect(res.json().data.impactKgCO2).toBe(0)
  })
})

describe('removing an entry', () => {
  it('only your own', async () => {
    const mine = (await post(me, { kind: 'habit', habit: 'tree' })).json().data.id
    const theirs = await app.inject({ method: 'DELETE', url: `/api/eco/${mine}`, headers: auth(other) })
    expect(theirs.statusCode).toBe(404)
    const ok = await app.inject({ method: 'DELETE', url: `/api/eco/${mine}`, headers: auth(me) })
    expect(ok.statusCode).toBe(200)
    expect(await prisma.ecoAction.count({ where: { id: mine } })).toBe(0)
  })
})

describe('eco score', () => {
  it('habits ticked and the low-carbon share of trips', async () => {
    // bag + power = 2 of 3 habits; trips: 1 walk, 1 car → 2/3×70 + 1/2×30 ≈ 62
    const result = await computeDailyScore(me.id)
    expect(result.components.eco).toBe(62)
  })
})
