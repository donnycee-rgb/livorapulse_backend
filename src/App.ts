import Fastify, { FastifyInstance } from 'fastify'
import helmet from '@fastify/helmet'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'

import { errorHandler } from './middleware/error'
import { authRoutes } from './routes/auth'
import { userRoutes } from './routes/user'
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

  //  FIXED CORS 
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

  app.setErrorHandler(errorHandler)

  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

  await app.register(authRoutes, { prefix: '/api/auth' })
  await app.register(userRoutes, { prefix: '/api/user' })
  await app.register(physicalRoutes, { prefix: '/api/activity/physical' })
  await app.register(digitalRoutes, { prefix: '/api/activity/digital' })
  await app.register(productivityRoutes, { prefix: '/api/productivity/session' })
  await app.register(moodRoutes, { prefix: '/api/mood' })
  await app.register(ecoRoutes, { prefix: '/api/eco' })
  await app.register(scoreRoutes, { prefix: '/api/score' })
  await app.register(aiRoutes, { prefix: '/api/ai' })

  return app
}