import { FastifyInstance } from 'fastify'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { insightFeedbackSchema, insightIdParamsSchema } from '../schemas/insights.schema'
import { prisma } from '../db/prisma'
import { activeInsights, insightStatus, toView } from '../services/InsightService'
import { AppError } from '../utils/response'

export async function insightRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  // GET /api/insights — the user's active insights, strongest first
  app.get('/', async (request, reply) => {
    const insights = await activeInsights(request.user!.id)
    return reply.send({ success: true, data: insights.map(toView) })
  })

  // GET /api/insights/status — how much data the user has, and how much more they need
  app.get('/status', async (request, reply) => {
    return reply.send({ success: true, data: await insightStatus(request.user!.id) })
  })

  // POST /api/insights/:id/feedback — "useful" or "not true for me"
  app.post('/:id/feedback', async (request, reply) => {
    const { id } = validate(insightIdParamsSchema, request.params)
    const { feedback } = validate(insightFeedbackSchema, request.body)
    const userId = request.user!.id

    // Scoped to the user: someone else's insight id is simply "not found"
    const insight = await prisma.insight.findFirst({ where: { id, userId } })
    if (!insight) throw new AppError('NOT_FOUND', 'Insight not found', 404)

    const updated = await prisma.insight.update({
      where: { id: insight.id },
      data:
        feedback === 'not-true'
          ? { feedback, status: 'dismissed', dismissedEffect: insight.effect }
          : { feedback },
    })
    return reply.send({ success: true, data: toView(updated) })
  })
}
