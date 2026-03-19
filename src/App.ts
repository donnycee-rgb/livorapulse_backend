import Fastify, { FastifyInstance } from 'fastify'
import helmet from '@fastify/helmet'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import fastifyCookie from '@fastify/cookie'
import fastifySession from '@fastify/session'
import FastifyPassport from '@fastify/passport'
import { Strategy as GoogleStrategy } from 'passport-google-oauth20'
import { prisma } from './db/prisma'

import { errorHandler } from './middleware/error'
import { authRoutes } from './routes/auth'
import { userRoutes } from './routes/user'
import { onboardingRoutes } from './routes/onboarding'
import { physicalRoutes } from './routes/physical'
import { digitalRoutes } from './routes/digital'
import { productivityRoutes } from './routes/productivity'
import { moodRoutes } from './routes/mood'
import { ecoRoutes } from './routes/eco'
import { scoreRoutes } from './routes/score'
import { aiRoutes } from './routes/ai'

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'warn' : 'info',
      transport:
        process.env.NODE_ENV !== 'production'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
  })

  await app.register(helmet, { global: true })

  const frontendUrl = (process.env.FRONTEND_URL ?? 'http://localhost:5173').replace(/\/$/, '')

  await app.register(cors, {
    origin: frontendUrl,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })

  await app.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many requests — please slow down.' },
    }),
  })

  // ── Cookie + Session (required by @fastify/passport) ──────────────────────
  await app.register(fastifyCookie)
  await app.register(fastifySession, {
    secret: process.env.SESSION_SECRET ?? 'fallback-secret-change-in-production',
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      httpOnly: true,
    },
    saveUninitialized: false,
  })

  // ── Passport initialisation ────────────────────────────────────────────────
  await app.register(FastifyPassport.initialize())
  await app.register(FastifyPassport.secureSession())

  // ── Google OAuth Strategy ──────────────────────────────────────────────────
  FastifyPassport.use(
    'google',
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        callbackURL: process.env.GOOGLE_CALLBACK_URL!,
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value
          const name = profile.displayName ?? 'User'
          const avatarUrl = profile.photos?.[0]?.value ?? null

          if (!email) {
            return done(new Error('No email returned from Google'), undefined)
          }

          // Find or create the user
          let user = await prisma.user.findUnique({ where: { email } })

          if (!user) {
            user = await prisma.user.create({
              data: {
                name,
                email,
                avatarUrl,
                // Google users have no password
                passwordHash: null,
                preferences: { create: {} },
              },
            })
          } else if (avatarUrl && !user.avatarUrl) {
            // Update avatar if not set
            user = await prisma.user.update({
              where: { id: user.id },
              data: { avatarUrl },
            })
          }

          return done(null, user)
        } catch (err) {
          return done(err as Error, undefined)
        }
      },
    ),
  )

  // Passport serialize/deserialize (required even for stateless JWT flow)
  FastifyPassport.registerUserSerializer(async (user: any) => user.id)
  FastifyPassport.registerUserDeserializer(async (id: string) => {
    return prisma.user.findUnique({ where: { id } })
  })

  app.setErrorHandler(errorHandler)

  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

  await app.register(authRoutes, { prefix: '/api/auth' })
  await app.register(userRoutes, { prefix: '/api/user' })
  await app.register(onboardingRoutes, { prefix: '/api/user/onboarding' })
  await app.register(physicalRoutes, { prefix: '/api/activity/physical' })
  await app.register(digitalRoutes, { prefix: '/api/activity/digital' })
  await app.register(productivityRoutes, { prefix: '/api/productivity/session' })
  await app.register(moodRoutes, { prefix: '/api/mood' })
  await app.register(ecoRoutes, { prefix: '/api/eco' })
  await app.register(scoreRoutes, { prefix: '/api/score' })
  await app.register(aiRoutes, { prefix: '/api/ai' })

  return app
}