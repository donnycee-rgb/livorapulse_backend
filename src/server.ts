import 'dotenv/config'
import { buildApp } from './App'
import { prisma } from './db/prisma'
import { redis } from './db/redis'
import { registerRepeatableJobs } from './jobs/queue'
import { dailySummaryWorker } from './jobs/workers/dailySummary'
import { streakWorker } from './jobs/workers/streak'

const PORT = parseInt(process.env.PORT ?? '4000', 10)
const HOST = process.env.HOST ?? '0.0.0.0'

async function start(): Promise<void> {
  // ── Verify DB connection ──────────────────────────────────────────────────
  try {
    await prisma.$connect()
    console.log('✓ PostgreSQL connected')
  } catch (err) {
    console.error('✗ PostgreSQL connection failed:', err)
    process.exit(1)
  }

  // ── Verify Redis connection ───────────────────────────────────────────────
  try {
    await redis.ping()
    console.log('✓ Redis connected')
  } catch (err) {
    console.error('✗ Redis connection failed:', err)
    process.exit(1)
  }

  // ── Register repeating BullMQ jobs ───────────────────────────────────────
  try {
    await registerRepeatableJobs()
    console.log('✓ Background jobs registered')
  } catch (err) {
    console.warn('⚠ Background jobs registration failed (non-fatal):', err)
  }

  // ── Start workers (log only — they self-initialise on import) ────────────
  console.log(`✓ Workers ready — dailySummary: ${dailySummaryWorker.isRunning()}, streak: ${streakWorker.isRunning()}`)

  // ── Build and start Fastify ───────────────────────────────────────────────
  const app = await buildApp()

  try {
    await app.listen({ port: PORT, host: HOST })
    console.log(`✓ LivoraPulse API running on http://${HOST}:${PORT}`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n${signal} received — shutting down gracefully…`)

    await Promise.allSettled([
      app.close(),
      dailySummaryWorker.close(),
      streakWorker.close(),
      prisma.$disconnect(),
      redis.quit(),
    ])

    console.log('✓ Shutdown complete')
    process.exit(0)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

start()