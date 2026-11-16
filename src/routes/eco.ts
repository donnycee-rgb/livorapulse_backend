import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { createEcoSchema } from '../schemas/eco.schema'
import { prisma } from '../db/prisma'
import { ecoWeekly } from '../services/AggregationService'
import { dayBounds } from '../utils/day'
import { tripAvoidedKg, type TripMode } from '../utils/green'
import { AppError } from '../utils/response'

const select = { id: true, category: true, type: true, impactKgCO2: true, distanceKm: true, timestamp: true }

export async function ecoRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  // POST /api/eco — a green habit (once a day) or a trip
  app.post('/', async (request, reply) => {
    const body = validate(createEcoSchema, request.body)
    const userId = request.user!.id
    const at = body.timestamp ? new Date(body.timestamp) : new Date()

    if (body.kind === 'habit') {
      // Ticking a habit twice in a day doesn't count twice
      const { start, end } = dayBounds(at)
      const existing = await prisma.ecoAction.findFirst({
        where: { userId, category: 'HABIT', type: body.habit, timestamp: { gte: start, lt: end } },
        select,
      })
      if (existing) return reply.send({ success: true, data: existing })
      const action = await prisma.ecoAction.create({
        data: { userId, category: 'HABIT', type: body.habit, impactKgCO2: 0, timestamp: at },
        select,
      })
      return reply.status(201).send({ success: true, data: action })
    }

    // A trip: CO₂ comes from how and how far, never from a typed number
    const action = await prisma.ecoAction.create({
      data: {
        userId, category: 'TRANSPORT', type: body.mode, distanceKm: body.distanceKm,
        impactKgCO2: tripAvoidedKg(body.mode as TripMode, body.distanceKm), timestamp: at,
      },
      select,
    })
    return reply.status(201).send({ success: true, data: action })
  })

  // DELETE /api/eco/:id — untick a habit or remove a trip (only your own)
  app.delete('/:id', async (request, reply) => {
    const { id } = validate(z.object({ id: z.string().min(1).max(64) }), request.params)
    const { count } = await prisma.ecoAction.deleteMany({ where: { id, userId: request.user!.id } })
    if (count === 0) throw new AppError('NOT_FOUND', 'Not found', 404)
    return reply.send({ success: true })
  })

  // GET /api/eco — the last two weeks (enough for this week's views)
  app.get('/', async (request, reply) => {
    const userId = request.user!.id
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
    const [data, weeklyAggregates] = await Promise.all([
      prisma.ecoAction.findMany({
        where: { userId, timestamp: { gte: since } },
        orderBy: { timestamp: 'desc' },
        take: 300,
        select,
      }),
      ecoWeekly(userId),
    ])
    return reply.send({ success: true, data, weeklyAggregates })
  })
}
