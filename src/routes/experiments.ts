import { FastifyInstance } from 'fastify'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { experimentCheckinSchema, experimentIdParamsSchema, startExperimentSchema } from '../schemas/experiments.schema'
import { checkIn, listExperiments, startExperiment, stopExperiment } from '../services/ExperimentService'

export async function experimentRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  // GET /api/experiments — the running experiment and recent results
  app.get('/', async (request, reply) => {
    return reply.send({ success: true, data: await listExperiments(request.user!.id) })
  })

  // POST /api/experiments — start a 14-day experiment from an insight
  app.post('/', async (request, reply) => {
    const body = validate(startExperimentSchema, request.body)
    await startExperiment(request.user!.id, body.insightId, body.change)
    return reply.status(201).send({ success: true, data: await listExperiments(request.user!.id) })
  })

  // POST /api/experiments/:id/checkin — "Did you do it today?"
  app.post('/:id/checkin', async (request, reply) => {
    const { id } = validate(experimentIdParamsSchema, request.params)
    const body = validate(experimentCheckinSchema, request.body)
    await checkIn(request.user!.id, id, body.did, body.day ?? 'today')
    return reply.send({ success: true, data: await listExperiments(request.user!.id) })
  })

  // POST /api/experiments/:id/stop — end early, without a result
  app.post('/:id/stop', async (request, reply) => {
    const { id } = validate(experimentIdParamsSchema, request.params)
    await stopExperiment(request.user!.id, id)
    return reply.send({ success: true, data: await listExperiments(request.user!.id) })
  })
}
