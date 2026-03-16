import { FastifyInstance } from 'fastify'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { updateProfileSchema } from '../schemas/user.schema'
import { prisma } from '../db/prisma'
import { AppError } from '../utils/response'

export async function userRoutes(app: FastifyInstance): Promise<void> {
  // All user routes require authentication
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
      },
    })
    if (!user) throw new AppError('NOT_FOUND', 'User not found', 404)
    return reply.send({ success: true, data: user })
  })

  // PUT /api/user/profile
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
        },
      })
      return user
    })

    return reply.send({ success: true, data: updated })
  })
}
