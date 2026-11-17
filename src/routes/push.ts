import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { prisma } from '../db/prisma'
import { AppError } from '../utils/response'
import { isTimeZone, toHHMM, toMinutes } from '../utils/reminders'
import { pushReady, sendToUser, vapidPublicKey } from '../services/PushService'

// Phone notifications: the app registers each phone that allowed them, and
// the person's sleep reminder settings live here. Sending is done by the
// reminders job (src/jobs/workers/reminders.ts).

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM')

const subscribeSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
})
const unsubscribeSchema = z.object({ endpoint: z.string().url().max(1000) })
const settingsSchema = z.object({
  /** "22:30", or null to switch the bedtime reminder off */
  bedtime: hhmm.nullable(),
  wakeReminder: z.boolean(),
  timezone: z.string().max(64).refine(isTimeZone, 'Unknown time zone'),
}).partial()
const sessionSchema = z.object({ startedAt: z.string().datetime().nullable() })

export async function pushRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  const settingsFor = async (userId: string) => {
    const [r, subs] = await Promise.all([
      prisma.reminderSettings.findUnique({ where: { userId } }),
      prisma.pushSubscription.count({ where: { userId } }),
    ])
    return {
      bedtime: r?.bedtimeMinutes != null ? toHHMM(r.bedtimeMinutes) : null,
      wakeReminder: r?.wakeReminder ?? true,
      timezone: r?.timezone ?? 'Africa/Nairobi',
      devices: subs,
    }
  }

  // GET /api/push/key — the public key a phone needs to subscribe (null: not set up on this server)
  app.get('/key', async (_request, reply) => reply.send({ success: true, data: { publicKey: vapidPublicKey() } }))

  // POST /api/push/subscribe — this phone allowed notifications
  app.post('/subscribe', async (request, reply) => {
    const userId = request.user!.id
    const body = validate(subscribeSchema, request.body)
    // The same phone used by another account moves to this one
    await prisma.pushSubscription.upsert({
      where: { endpoint: body.endpoint },
      create: { userId, endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth },
      update: { userId, p256dh: body.keys.p256dh, auth: body.keys.auth },
    })
    await prisma.reminderSettings.upsert({ where: { userId }, create: { userId }, update: {} })
    return reply.send({ success: true, data: await settingsFor(userId) })
  })

  // POST /api/push/unsubscribe — notifications switched off on this phone
  app.post('/unsubscribe', async (request, reply) => {
    const userId = request.user!.id
    const { endpoint } = validate(unsubscribeSchema, request.body)
    await prisma.pushSubscription.deleteMany({ where: { userId, endpoint } })
    return reply.send({ success: true })
  })

  // GET /api/push/settings
  app.get('/settings', async (request, reply) => reply.send({ success: true, data: await settingsFor(request.user!.id) }))

  // PUT /api/push/settings — bedtime time (or off), morning reminder, time zone
  app.put('/settings', async (request, reply) => {
    const userId = request.user!.id
    const body = validate(settingsSchema, request.body)
    const data = {
      ...(body.bedtime !== undefined ? { bedtimeMinutes: body.bedtime === null ? null : toMinutes(body.bedtime), bedtimeSentOn: null } : {}),
      ...(body.wakeReminder !== undefined ? { wakeReminder: body.wakeReminder } : {}),
      ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
    }
    await prisma.reminderSettings.upsert({ where: { userId }, create: { userId, ...data }, update: data })
    return reply.send({ success: true, data: await settingsFor(userId) })
  })

  // GET /api/push/sleep-session — a sleep in progress, so every device shows the same banner
  app.get('/sleep-session', async (request, reply) => {
    const r = await prisma.reminderSettings.findUnique({ where: { userId: request.user!.id }, select: { sleepStartedAt: true } })
    return reply.send({ success: true, data: { startedAt: r?.sleepStartedAt?.toISOString() ?? null } })
  })

  // POST /api/push/sleep-session — "Going to sleep" tapped (startedAt), or ended (null)
  app.post('/sleep-session', async (request, reply) => {
    const userId = request.user!.id
    const { startedAt } = validate(sessionSchema, request.body)
    const at = startedAt ? new Date(startedAt) : null
    if (at && at.getTime() > Date.now() + 10 * 60000) throw new AppError('VALIDATION_ERROR', "A sleep can't start in the future", 400)
    await prisma.reminderSettings.upsert({
      where: { userId },
      create: { userId, sleepStartedAt: at },
      update: { sleepStartedAt: at },
    })
    return reply.send({ success: true })
  })

  // POST /api/push/test — "Send a test" in Settings
  app.post('/test', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (request, reply) => {
    if (!pushReady()) throw new AppError('UNAVAILABLE', 'Notifications are not set up on the server yet', 503)
    const sent = await sendToUser(request.user!.id, {
      title: 'Notifications are on',
      body: "This is how LivoraPulse reminders will look. You're all set.",
      url: '/settings',
      tag: 'test',
    })
    if (sent === 0) throw new AppError('NOT_FOUND', 'No phone with notifications allowed. Turn them on again.', 404)
    return reply.send({ success: true, data: { sent } })
  })
}
