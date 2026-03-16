import { FastifyInstance } from 'fastify'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { dailyScoreQuerySchema } from '../schemas/score.schema'
import { computeDailyScore } from '../services/ScoreService'

export async function scoreRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  // GET /api/score/daily?date=YYYY-MM-DD
  app.get('/daily', async (request, reply) => {
    const query = validate(dailyScoreQuerySchema, request.query)
    const date = query.date ? new Date(query.date) : new Date()
    const result = await computeDailyScore(request.user!.id, date)
    return reply.send({ success: true, ...result })
  })
}
