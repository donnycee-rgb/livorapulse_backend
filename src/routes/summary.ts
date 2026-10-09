import { FastifyInstance, FastifyReply } from 'fastify'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { createShareSchema, shareIdParamsSchema, shareTokenParamsSchema, summaryQuerySchema } from '../schemas/summary.schema'
import { buildSummaryFor, createShare, listShares, openShare, revokeShare } from '../services/HealthSummaryService'
import { renderSummaryPdf } from '../services/SummaryPdf'
import type { HealthSummary } from '../insights/summary'

const frontendUrl = () => (process.env.FRONTEND_URL ?? 'http://localhost:5173').replace(/\/$/, '')

/** Health data: never cached by browsers or proxies, never indexed */
function privateHeaders(reply: FastifyReply): FastifyReply {
  return reply.header('Cache-Control', 'no-store').header('X-Robots-Tag', 'noindex, nofollow')
}

async function sendPdf(reply: FastifyReply, summary: HealthSummary) {
  const pdf = await renderSummaryPdf(summary)
  return privateHeaders(reply)
    .type('application/pdf')
    .header('Content-Disposition', `attachment; filename="health-summary-${summary.period.to}.pdf"`)
    .send(pdf)
}

// ── Signed-in user: their own summary and share links ────────────────────────
export async function summaryRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  // GET /api/summary?months=1|3&notes=true|false — preview
  app.get('/', async (request, reply) => {
    const q = validate(summaryQuerySchema, request.query)
    return privateHeaders(reply).send({ success: true, data: await buildSummaryFor(request.user!.id, q.months, q.notes) })
  })

  // GET /api/summary/pdf?months=1|3&notes=true|false — download
  app.get('/pdf', async (request, reply) => {
    const q = validate(summaryQuerySchema, request.query)
    return sendPdf(reply, await buildSummaryFor(request.user!.id, q.months, q.notes))
  })

  // POST /api/summary/share — make a 7-day link; the token is only ever returned here
  app.post('/share', async (request, reply) => {
    const body = validate(createShareSchema, request.body)
    const { token, ...share } = await createShare(request.user!.id, body.months, body.includeNotes)
    return privateHeaders(reply).status(201).send({
      success: true,
      data: { ...share, url: `${frontendUrl()}/shared/summary/${token}` },
    })
  })

  // GET /api/summary/shares — links that still work
  app.get('/shares', async (request, reply) => {
    return reply.send({ success: true, data: await listShares(request.user!.id) })
  })

  // DELETE /api/summary/shares/:id — revoke now
  app.delete('/shares/:id', async (request, reply) => {
    const { id } = validate(shareIdParamsSchema, request.params)
    await revokeShare(request.user!.id, id)
    return reply.send({ success: true, data: { revoked: true } })
  })
}

// ── Public: whoever has the link (e.g. a doctor) ─────────────────────────────
export async function sharedSummaryRoutes(app: FastifyInstance): Promise<void> {
  // Guessing tokens is hopeless (256 bits), but keep traffic per IP modest anyway
  const limit = { rateLimit: { max: 30, timeWindow: '1 minute' } }

  // GET /api/shared/summary/:token
  app.get('/:token', { config: limit }, async (request, reply) => {
    const { token } = validate(shareTokenParamsSchema, request.params)
    return privateHeaders(reply).send({ success: true, data: await openShare(token) })
  })

  // GET /api/shared/summary/:token/pdf
  app.get('/:token/pdf', { config: limit }, async (request, reply) => {
    const { token } = validate(shareTokenParamsSchema, request.params)
    return sendPdf(reply, await openShare(token))
  })
}
