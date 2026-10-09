import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/App'
import { prisma } from '../../src/db/prisma'
import { computeFeatures } from '../../src/services/FeatureService'
import { refreshFlags } from '../../src/services/FlagService'
import { refreshInsights } from '../../src/services/InsightService'
import { addDays, dayKey, startOfDay } from '../../src/utils/day'
import { signAccessToken } from '../../src/utils/jwt'

// The real Fastify app on the test database, called through app.inject

type U = { id: string; email: string }
let app: FastifyInstance
let me: U
let other: U

const today = dayKey()
const at = (d: number, h: number) => new Date(startOfDay(addDays(today, -d)).getTime() + h * 3600_000)
const auth = (u: U) => ({ authorization: `Bearer ${signAccessToken({ id: u.id, email: u.email })}` })
const call = (method: 'GET' | 'POST' | 'DELETE', url: string, user?: U | null, payload?: object) =>
  app.inject({ method, url, headers: user ? auth(user) : {}, payload })

beforeAll(async () => {
  process.env.HEALTH_FLAGS_ENABLED = 'true'
  app = await buildApp()
  const mk = (name: string) =>
    prisma.user.create({ data: { name, email: `${name}-${Date.now()}@example.test`, profile: { create: { onboardingComplete: true, gender: 'female' } } } })
  me = await mk('me')
  other = await mk('other')

  for (let d = 60; d >= 1; d--) {
    const sleep = d % 2 === 0 ? 320 : 470
    await prisma.physicalActivityEntry.create({ data: { userId: me.id, steps: 0, distanceKm: 0, caloriesKcal: 0, sleepMinutes: sleep, timestamp: at(d, 7) } })
    await prisma.moodLog.create({ data: { userId: me.id, emoji: '🙂', stressScore: sleep < 360 ? 8 : 4, timestamp: at(d, 12) } })
  }
  for (const [i, s] of [80, 40, 1].entries()) {
    await prisma.cycleLog.create({ data: { userId: me.id, periodStartDate: at(s, 6), periodDuration: 5, flowIntensity: 'heavy', symptoms: i === 0 ? ['Cramps'] : ['Severe cramps'] } })
  }
  await computeFeatures(me.id, addDays(today, -80), addDays(today, -1))
  await refreshInsights(me.id, today)
  await refreshFlags(me.id, today)
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [me.id, other.id] } } })
  await app.close()
  await prisma.$disconnect()
})

describe('every new route', () => {
  it('needs sign-in', async () => {
    for (const url of ['/api/insights', '/api/insights/status', '/api/experiments', '/api/summary', '/api/summary/shares', '/api/flags']) {
      expect((await call('GET', url)).statusCode, url).toBe(401)
    }
  })
})

describe('insights', () => {
  it('lists insights and progress', async () => {
    const list = (await call('GET', '/api/insights', me)).json().data
    expect(list.length).toBeGreaterThanOrEqual(1)
    expect(list[0].comparison).toBeDefined()
    expect((await call('GET', '/api/insights/status', me)).json().data.minDays).toBe(14)
  })

  it('takes feedback on your own insights only, validated', async () => {
    const [first] = (await call('GET', '/api/insights', me)).json().data
    expect((await call('POST', `/api/insights/${first.id}/feedback`, other, { feedback: 'useful' })).statusCode).toBe(404)
    const bad = await call('POST', `/api/insights/${first.id}/feedback`, me, { feedback: 'meh' })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error.code).toBe('VALIDATION_ERROR')
    expect((await call('POST', `/api/insights/${first.id}/feedback`, me, { feedback: 'useful' })).json().data.feedback).toBe('useful')
  })
})

describe('experiments', () => {
  it('starts one at a time, takes check-ins from the owner only, and stops', async () => {
    const list = (await call('GET', '/api/insights', me)).json().data
    const withSuggestion = list.find((i: { suggestion: string | null }) => i.suggestion)
    const started = await call('POST', '/api/experiments', me, { insightId: withSuggestion.id })
    expect(started.statusCode).toBe(201)
    const id = started.json().data.active.id
    expect((await call('POST', '/api/experiments', me, { insightId: withSuggestion.id })).statusCode).toBe(409)
    expect((await call('POST', `/api/experiments/${id}/checkin`, other, { did: true })).statusCode).toBe(404)
    expect((await call('POST', `/api/experiments/${id}/checkin`, me, { did: true })).json().data.active.today).toBe(true)
    expect((await call('POST', `/api/experiments/${id}/stop`, me)).json().data.active).toBeNull()
  })
})

describe('health summary and sharing', () => {
  it('returns the summary (not cached), validates months, and serves a PDF', async () => {
    const res = await call('GET', '/api/summary?months=3&notes=false', me)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.json().data.period.days).toBe(91)
    expect((await call('GET', '/api/summary?months=2', me)).statusCode).toBe(400)
    const pdf = await call('GET', '/api/summary/pdf?months=1', me)
    expect(pdf.headers['content-type']).toBe('application/pdf')
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('shares a link that works without sign-in until revoked', async () => {
    const share = await call('POST', '/api/summary/share', me, { months: 1, includeNotes: false })
    expect(share.statusCode).toBe(201)
    const token = share.json().data.url.split('/').pop()
    const pub = await call('GET', `/api/shared/summary/${token}`, null)
    expect(pub.statusCode).toBe(200)
    expect(pub.headers['x-robots-tag']).toBe('noindex, nofollow')
    expect((await call('GET', `/api/shared/summary/${token}/pdf`, null)).headers['content-type']).toBe('application/pdf')
    expect((await call('GET', '/api/shared/summary/not-a-token', null)).statusCode).toBe(400)
    expect((await call('DELETE', `/api/summary/shares/${share.json().data.id}`, other)).statusCode).toBe(404)
    expect((await call('DELETE', `/api/summary/shares/${share.json().data.id}`, me)).statusCode).toBe(200)
    expect((await call('GET', `/api/shared/summary/${token}`, null)).statusCode).toBe(404)
  })
})

describe('flags', () => {
  it("shows only the owner's flags, which only they can dismiss", async () => {
    const data = (await call('GET', '/api/flags', me)).json().data
    expect(data.enabled).toBe(true)
    // Heavy flow on all 3 periods: raised. Severe cramps on 2 of 3: correctly not raised.
    expect(data.flags.map((f: { key: string }) => f.key)).toEqual(['heavy-flow'])
    expect((await call('GET', '/api/flags', other)).json().data.flags).toEqual([])
    expect((await call('POST', `/api/flags/${data.flags[0].id}/dismiss`, other)).statusCode).toBe(404)
    expect((await call('POST', `/api/flags/${data.flags[0].id}/dismiss`, me)).statusCode).toBe(200)
  })

  it('hides flags everywhere when switched off', async () => {
    process.env.HEALTH_FLAGS_ENABLED = 'false'
    expect((await call('GET', '/api/flags', me)).json().data).toEqual({ enabled: false, flags: [] })
    expect((await call('GET', '/api/summary?months=1', me)).json().data.flags).toEqual([])
    process.env.HEALTH_FLAGS_ENABLED = 'true'
  })
})

describe('mood check-ins', () => {
  it('accepts stress only, and rejects an empty check-in', async () => {
    expect((await call('POST', '/api/mood', me, { stressScore: 6 })).statusCode).toBe(201)
    expect((await call('POST', '/api/mood', me, {})).statusCode).toBe(400)
  })
})
