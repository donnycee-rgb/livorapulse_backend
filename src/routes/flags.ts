import { FastifyInstance } from 'fastify'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { flagIdParamsSchema } from '../schemas/flags.schema'
import { activeFlags, dismissFlag, flagsEnabled } from '../services/FlagService'

export async function flagRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  // GET /api/flags — the user's active "worth getting checked" flags (empty while switched off)
  app.get('/', async (request, reply) => {
    return reply
      .header('Cache-Control', 'no-store')
      .send({ success: true, data: { enabled: flagsEnabled(), flags: await activeFlags(request.user!.id) } })
  })

  // POST /api/flags/:id/dismiss — hide it; it can come back after 30 days if the pattern is still there
  app.post('/:id/dismiss', async (request, reply) => {
    const { id } = validate(flagIdParamsSchema, request.params)
    await dismissFlag(request.user!.id, id)
    return reply.send({ success: true, data: { dismissed: true } })
  })
}
