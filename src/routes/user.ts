import { Prisma } from '@prisma/client'
import { FastifyInstance } from 'fastify'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { updateProfileSchema, walkRouteSchema } from '../schemas/user.schema'
import { KENYA_TOWNS, buildRoute, roundLocation, townByName } from '../utils/walkRoute'
import { nearbyPlaces } from '../services/PlacesService'
import { prisma } from '../db/prisma'
import { AppError } from '../utils/response'

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  // GET /api/user/profile
  app.get('/profile', async (request, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: request.user!.id },
      select: {
        id: true,
        name: true,
        email: true,
        avatarUrl: true,
        createdAt: true,
        preferences: {
          select: {
            theme: true,
            units: true,
            notificationsEnabled: true,
            focusMode: true,
          },
        },
        profile: {
          select: {
            onboardingComplete: true,
            primaryGoal: true,
            goals: true,
            walkArea: true,
            walkRoute: true,
            goalStepsPerDay: true,
            goalSleepHours: true,
            goalScreenMinutes: true,
            goalFocusMinutes: true,
            goalEcoActionsPerDay: true,
            goalSocialMinutes: true,
            goalEntertainmentMinutes: true,
            goalCaloriesPerDay: true,
            weightKg: true,
            hasDisability: true,
            gender: true,
          cycleTracking: true,
            dateOfBirth: true,
          },
        },
      },
    })
    if (!user) throw new AppError('NOT_FOUND', 'User not found', 404)
    return reply.send({ success: true, data: user })
  })

  // PUT /api/user/profile
  // POST /api/user/walk-route — build the walking journey from a rough
  // location or a town, and save it (the location is not stored)
  app.post('/walk-route', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (request, reply) => {
    const userId = request.user!.id
    const body = validate(walkRouteSchema, request.body)
    let saved: { walkArea: string | null; walkRoute: unknown } = { walkArea: null, walkRoute: null }
    if (!('clear' in body)) {
      const town = 'town' in body ? townByName(body.town) : null
      if ('town' in body && !town) throw new AppError('NOT_FOUND', 'Unknown town', 404)
      const origin = town ?? roundLocation(body as { lat: number; lng: number })
      const route = buildRoute(origin, await nearbyPlaces(origin))
      const area = town ? town.name : route?.area ?? 'Your area'
      saved = { walkArea: area, walkRoute: route ? route.stops : null }
    }
    await prisma.userProfile.upsert({
      where: { userId },
      create: { userId, walkArea: saved.walkArea, walkRoute: saved.walkRoute ?? undefined },
      update: { walkArea: saved.walkArea, walkRoute: saved.walkRoute === null ? Prisma.JsonNull : saved.walkRoute },
    })
    return reply.send({ success: true, data: { area: saved.walkArea, stops: saved.walkRoute } })
  })

  // GET /api/user/walk-towns — towns to pick from instead of sharing a location
  app.get('/walk-towns', async (_request, reply) => {
    return reply.send({ success: true, data: KENYA_TOWNS.map((t) => t.name).sort((a, b) => a.localeCompare(b)) })
  })

  app.put('/profile', async (request, reply) => {
    const body = validate(updateProfileSchema, request.body)
    const userId = request.user!.id

    const updated = await prisma.$transaction(async (tx) => {
      const userUpdate: Record<string, unknown> = {}
      if (body.name !== undefined) userUpdate['name'] = body.name
      if (body.avatarUrl !== undefined) userUpdate['avatarUrl'] = body.avatarUrl

      const user = await tx.user.update({
        where: { id: userId },
        data: {
          ...userUpdate,
          ...(body.preferences
            ? {
                preferences: {
                  upsert: {
                    create: { ...body.preferences },
                    update: { ...body.preferences },
                  },
                },
              }
            : {}),
        },
        select: {
          id: true,
          name: true,
          email: true,
          avatarUrl: true,
          preferences: {
            select: {
              theme: true,
              units: true,
              notificationsEnabled: true,
              focusMode: true,
            },
          },
          profile: {
            select: {
              onboardingComplete: true,
              primaryGoal: true,
              goals: true,
              walkArea: true,
              walkRoute: true,
              goalStepsPerDay: true,
              goalSleepHours: true,
              goalScreenMinutes: true,
              goalFocusMinutes: true,
              goalEcoActionsPerDay: true,
              goalSocialMinutes: true,
              goalEntertainmentMinutes: true,
              goalCaloriesPerDay: true,
              weightKg: true,
            },
          },
        },
      })
      return user
    })

    return reply.send({ success: true, data: updated })
  })
}