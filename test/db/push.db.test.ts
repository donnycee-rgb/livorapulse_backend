import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/App'
import { prisma } from '../../src/db/prisma'
import { setPushSender } from '../../src/services/PushService'
import { runReminders } from '../../src/services/ReminderService'
import { signAccessToken } from '../../src/utils/jwt'

// Phone notifications and sleep reminders, with a fake push service

type U = { id: string; email: string }
let app: FastifyInstance
let me: U
let other: U
const sent: Array<{ endpoint: string; msg: { title: string; url: string } }> = []
let gone = new Set<string>()
const auth = (u: U) => ({ authorization: `Bearer ${signAccessToken({ id: u.id, email: u.email })}` })
const call = (u: U, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) => app.inject({ method, url: `/api/push${url}`, headers: auth(u), payload })
const sub = (n: string) => ({ endpoint: `https://push.example.test/${n}`, keys: { p256dh: 'BPx'.padEnd(80, 'x'), auth: 'authsecret12' } })
const nbo = (local: string) => new Date(`${local}+03:00`)

beforeAll(async () => {
  setPushSender(async (s, payload) => {
    if (gone.has(s.endpoint)) throw Object.assign(new Error('Gone'), { statusCode: 410 })
    sent.push({ endpoint: s.endpoint, msg: JSON.parse(payload) })
  })
  app = await buildApp()
  const mk = (n: string) => prisma.user.create({ data: { name: n, email: `${n}-${Date.now()}@example.test`, profile: { create: { onboardingComplete: true } } } })
  me = await mk('pusher')
  other = await mk('pusher-2')
})

beforeEach(() => { sent.length = 0; gone = new Set() })

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [me.id, other.id] } } })
  await app.close()
  await prisma.$disconnect()
})

describe('allowing notifications', () => {
  it('saves the phone once, and a phone signed into another account moves to it', async () => {
    expect((await call(me, 'POST', '/subscribe', sub('a'))).statusCode).toBe(200)
    expect((await call(me, 'POST', '/subscribe', sub('a'))).json().data.devices).toBe(1)
    await call(other, 'POST', '/subscribe', sub('shared'))
    await call(me, 'POST', '/subscribe', sub('shared'))
    expect(await prisma.pushSubscription.count({ where: { userId: me.id } })).toBe(2)
    expect(await prisma.pushSubscription.count({ where: { userId: other.id } })).toBe(0)
  })

  it('refuses addresses that are not real', async () => {
    expect((await call(me, 'POST', '/subscribe', { endpoint: 'not a url', keys: { p256dh: 'x', auth: 'y' } })).statusCode).toBe(400)
  })
})

describe('reminder settings', () => {
  it('bedtime, morning reminder and time zone', async () => {
    const res = await call(me, 'PUT', '/settings', { bedtime: '22:30', wakeReminder: true, timezone: 'Africa/Nairobi' })
    expect(res.json().data).toMatchObject({ bedtime: '22:30', wakeReminder: true, timezone: 'Africa/Nairobi', devices: 2 })
    expect((await call(me, 'PUT', '/settings', { bedtime: '25:00' })).statusCode).toBe(400)
    expect((await call(me, 'PUT', '/settings', { timezone: 'Mars/Olympus' })).statusCode).toBe(400)
  })
})

describe('the reminder job', () => {
  it('sends the bedtime reminder once a night, to every phone', async () => {
    expect(await runReminders(nbo('2026-11-20T22:31:00'))).toMatchObject({ bedtime: 1 })
    expect(sent).toHaveLength(2)
    expect(sent[0].msg).toMatchObject({ title: 'Time to wind down', url: '/physical?tab=sleep' })
    expect(await runReminders(nbo('2026-11-20T22:36:00'))).toMatchObject({ bedtime: 0 })
  })

  it('morning reminder while a sleep is running; none once it is saved', async () => {
    await call(me, 'POST', '/sleep-session', { startedAt: nbo('2026-11-10T22:50:00').toISOString() })
    expect(await runReminders(nbo('2026-11-11T06:45:00'))).toMatchObject({ wake: 1 })
    expect(sent.at(-1)!.msg).toMatchObject({ title: 'Good morning', url: '/physical?sleep=wake' })
    expect(await runReminders(nbo('2026-11-11T07:00:00'))).toMatchObject({ wake: 0 }) // once per sleep
    await call(me, 'POST', '/sleep-session', { startedAt: null })
    expect((await prisma.reminderSettings.findUniqueOrThrow({ where: { userId: me.id } })).sleepStartedAt).toBeNull()
  })

  it('forgets a phone the push service says is gone', async () => {
    gone.add(sub('a').endpoint)
    await call(me, 'PUT', '/settings', { bedtime: '22:30' }) // resets "sent tonight"
    await runReminders(nbo('2026-11-21T22:31:00'))
    expect(await prisma.pushSubscription.count({ where: { userId: me.id } })).toBe(1)
  })

  it('people without notifications allowed are skipped', async () => {
    await call(other, 'PUT', '/settings', { bedtime: '22:30' })
    await runReminders(nbo('2026-11-22T22:31:00'))
    expect(sent.every((s) => s.endpoint !== sub('other').endpoint)).toBe(true)
  })
})

describe('saving a night with times', () => {
  it('ends the running sleep for the reminders', async () => {
    await call(me, 'POST', '/sleep-session', { startedAt: new Date(Date.now() - 8 * 3600000).toISOString() })
    const ago = (m: number) => new Date(Date.now() - m * 60000).toISOString()
    await app.inject({
      method: 'POST', url: '/api/activity/physical', headers: auth(me),
      payload: { steps: 0, distanceKm: 0, caloriesKcal: 0, sleepMinutes: 0, sleepType: 'night', sleepStart: ago(480), sleepEnd: ago(5) },
    })
    expect((await prisma.reminderSettings.findUniqueOrThrow({ where: { userId: me.id } })).sleepStartedAt).toBeNull()
  })
})

describe('test notification', () => {
  it('goes to the phones that allowed it', async () => {
    const res = await call(me, 'POST', '/test')
    expect(res.statusCode).toBe(200)
    expect(sent.at(-1)!.msg.title).toBe('Notifications are on')
  })
})
