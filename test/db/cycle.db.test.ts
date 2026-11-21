import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/App'
import { prisma } from '../../src/db/prisma'
import { addDays, dayKey } from '../../src/utils/day'
import { signAccessToken } from '../../src/utils/jwt'

// The cycle tracker through the real routes: days in, periods and predictions out

type U = { id: string; email: string }
let app: FastifyInstance
let her: U
let him: U
let old: U
const auth = (u: U) => ({ authorization: `Bearer ${signAccessToken({ id: u.id, email: u.email })}` })
const logDay = (u: U, payload: object) => app.inject({ method: 'POST', url: '/api/cycle/days', headers: auth(u), payload })
const get = (u: U, url: string) => app.inject({ method: 'GET', url, headers: auth(u) })
const today = dayKey()
const ago = (n: number) => addDays(today, -n)

beforeAll(async () => {
  app = await buildApp()
  const mk = (n: string, gender: string) =>
    prisma.user.create({ data: { name: n, email: `${n}-${Date.now()}@example.test`, profile: { create: { onboardingComplete: true, gender } } } })
  her = await mk('cycle', 'female')
  him = await mk('cycle-m', 'male')
  old = await mk('cycle-old', 'female')
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [her.id, him.id, old.id] } } })
  await app.close()
  await prisma.$disconnect()
})

describe('logging days', () => {
  it('one row per day, however many times it is saved', async () => {
    expect((await logDay(her, { date: ago(2), flow: 'light' })).statusCode).toBe(200)
    expect((await logDay(her, { date: ago(2), flow: 'heavy', symptoms: ['Cramps'] })).statusCode).toBe(200)
    const rows = await prisma.periodDay.findMany({ where: { userId: her.id } })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ flow: 'heavy', symptoms: ['Cramps'] })
  })

  it('refuses future days and bad input', async () => {
    expect((await logDay(her, { date: addDays(today, 5) })).statusCode).toBe(400)
    expect((await logDay(her, { date: ago(1), flow: 'gushing' })).statusCode).toBe(400)
  })

  it('periods are rebuilt into CycleLog for flags, insights and the coach', async () => {
    await logDay(her, { date: ago(1), flow: 'medium' })
    await logDay(her, { date: today, flow: 'light' })
    const logs = await prisma.cycleLog.findMany({ where: { userId: her.id } })
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ periodDuration: 3, flowIntensity: 'heavy' })
  })

  it('removing a day shortens the period', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/cycle/days/remove', headers: auth(her), payload: { date: today } })
    expect(res.statusCode).toBe(200)
    expect((await prisma.cycleLog.findFirstOrThrow({ where: { userId: her.id } })).periodDuration).toBe(2)
  })
})

describe('history and status', () => {
  it('backfilled older periods give real cycle lengths, newest first', async () => {
    // two earlier periods, logged after the current one
    for (const start of [58, 30]) for (let i = 0; i < 4; i++) await logDay(her, { date: ago(start - i) })
    const res = (await get(her, '/api/cycle/history')).json().data
    expect(res.periods.map((p: { start: string }) => p.start)).toEqual([ago(2), ago(30), ago(58)])
    expect(res.periods[1].cycleLength).toBe(28)
    expect(res.cycles).toBe(2)
  })

  it("today's place in the cycle", async () => {
    const data = (await get(her, '/api/cycle')).json().data
    expect(data).toMatchObject({ lastPeriodStart: ago(2), dayOfCycle: 3, phase: 'menstrual', smartCycleLength: 28 })
    expect(data.nextPeriodDate).toBe(addDays(ago(2), 28))
  })

  it('calendar marks for a range', async () => {
    const { days, marks } = (await get(her, `/api/cycle/days?from=${ago(40)}&to=${addDays(today, 40)}`)).json().data
    expect(days.length).toBe(6)
    expect(marks[ago(30)]).toBe('period')
    expect(marks[addDays(ago(2), 28)]).toBe('predicted-period')
  })

  it('nothing logged → no status', async () => {
    expect((await get(him, '/api/cycle')).json().data).toBeNull()
  })
})

describe('settings', () => {
  it('tracking is on by default for women, off for everyone else, and can be switched', async () => {
    expect((await get(her, '/api/cycle/settings')).json().data.tracking).toBe(true)
    expect((await get(him, '/api/cycle/settings')).json().data.tracking).toBe(false)
    await app.inject({ method: 'PUT', url: '/api/cycle/settings', headers: auth(him), payload: { tracking: true } })
    expect((await get(him, '/api/cycle/settings')).json().data.tracking).toBe(true)
  })
})

describe('migration', () => {
  it('turns each old period log into its days', async () => {
    await prisma.cycleLog.create({
      data: { userId: old.id, periodStartDate: new Date(`${ago(20)}T00:00:00.000Z`), periodDuration: 3, cycleLength: 28, flowIntensity: 'medium', symptoms: ['Bloating'] },
    })
    const sql = readFileSync(join(__dirname, '../../prisma/migrations/20261118120000_period_days/migration.sql'), 'utf8')
    await prisma.$executeRawUnsafe(sql.slice(sql.indexOf('INSERT INTO "PeriodDay"')).replace(/;\s*$/, ''))
    const days = await prisma.periodDay.findMany({ where: { userId: old.id }, orderBy: { date: 'asc' } })
    expect(days.map((d) => d.date.toISOString().slice(0, 10))).toEqual([ago(20), ago(19), ago(18)])
    expect(days[0]).toMatchObject({ flow: 'medium', symptoms: ['Bloating'] })
    expect(days[1].flow).toBeNull()
  })
})

describe('my period ended', () => {
  const ended = (u: U, payload: object) => app.inject({ method: 'POST', url: '/api/cycle/period-ended', headers: auth(u), payload })
  let u: U
  beforeAll(async () => {
    u = await prisma.user.create({ data: { name: 'ended', email: `ended-${Date.now()}@example.test`, profile: { create: { onboardingComplete: true, gender: 'female' } } } })
    for (const n of [3, 2, 1]) await logDay(u, { date: ago(n), flow: 'light' })
  })
  afterAll(async () => { await prisma.user.deleteMany({ where: { id: u.id } }) })

  it('stops the period on every device, and can be taken back', async () => {
    expect((await get(u, '/api/cycle')).json().data).toMatchObject({ periodActive: true, lastPeriodEnd: ago(1) })
    expect((await ended(u, { lastDay: ago(1) })).statusCode).toBe(200)
    expect((await get(u, '/api/cycle')).json().data.periodActive).toBe(false)
    expect((await ended(u, { ended: false })).statusCode).toBe(200)
    expect((await get(u, '/api/cycle')).json().data.periodActive).toBe(true)
  })

  it('logging today after saying it ended reopens it', async () => {
    await ended(u, { lastDay: ago(1) })
    await logDay(u, { date: today, flow: 'spotting' })
    expect((await get(u, '/api/cycle')).json().data.periodActive).toBe(true)
  })

  it('refuses a future day and bad input', async () => {
    expect((await ended(u, { lastDay: addDays(today, 5) })).statusCode).toBe(400)
    expect((await ended(u, { ended: true })).statusCode).toBe(400)
  })
})
