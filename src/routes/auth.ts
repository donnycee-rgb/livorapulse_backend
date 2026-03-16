import { FastifyInstance } from 'fastify'
import FastifyPassport from '@fastify/passport'
import { validate } from '../middleware/validate'
import { authenticate } from '../middleware/authenticate'
import {
  registerSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  forgotPasswordSchema,
} from '../schemas/auth.schema'
import * as AuthService from '../services/AuthService'

/** Tight rate limit applied to register and login to prevent brute-force. */
const authRateLimit = { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/auth/register
  app.post('/register', authRateLimit, async (request, reply) => {
    const body = validate(registerSchema, request.body)
    const result = await AuthService.register(body)
    return reply.status(201).send({ success: true, ...result })
  })

  // POST /api/auth/login
  app.post('/login', authRateLimit, async (request, reply) => {
    const body = validate(loginSchema, request.body)
    const result = await AuthService.login(body)
    return reply.send({ success: true, ...result })
  })

  // POST /api/auth/logout  (requires valid access token)
  app.post('/logout', { preHandler: authenticate }, async (request, reply) => {
    const body = validate(logoutSchema, request.body)
    await AuthService.logout(body.refreshToken)
    return reply.send({ success: true, message: 'Logged out' })
  })

  // POST /api/auth/refresh
  app.post('/refresh', async (request, reply) => {
    const body = validate(refreshSchema, request.body)
    const tokens = await AuthService.refresh(body.refreshToken)
    return reply.send({ success: true, ...tokens })
  })

  // GET /api/auth/me
  app.get('/me', { preHandler: authenticate }, async (request, reply) => {
    const user = await AuthService.getMe(request.user!.id)
    return reply.send({ success: true, data: user })
  })

  // POST /api/auth/forgot-password
  app.post('/forgot-password', async (request, reply) => {
    const body = validate(forgotPasswordSchema, request.body)
    await AuthService.forgotPassword(body.email)
    return reply.send({
      success: true,
      message: 'If that email exists, a reset link has been sent',
    })
  })

  // GET /api/auth/google  — initiates OAuth flow
  app.get(
    '/google',
    { preValidation: FastifyPassport.authenticate('google', { scope: ['profile', 'email'] }) },
    async () => {
      // Handler never runs — preValidation redirects to Google
    },
  )

  // GET /api/auth/google/callback
  app.get(
    '/google/callback',
    {
      preValidation: FastifyPassport.authenticate('google', {
        failureRedirect: `${process.env.FRONTEND_URL ?? 'http://localhost:5173'}/login?error=oauth_failed`,
      }),
    },
    async (request, reply) => {
      const oauthUser = request.user!
      const tokens = await AuthService.issueTokensForUser(oauthUser.id, oauthUser.email)
      return reply.redirect(
        `${process.env.FRONTEND_URL ?? 'http://localhost:5173'}/dashboard?token=${tokens.accessToken}`,
      )
    },
  )
}
