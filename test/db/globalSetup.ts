import { execFile } from 'child_process'
import { promisify } from 'util'
import { createServer } from 'net'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'

/** A free local port */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number }
      s.close(() => resolve(port))
    })
    s.on('error', reject)
  })
}

/**
 * Starts an in-memory Postgres (PGlite) on a local port, applies every
 * migration, and points DATABASE_URL at it. Nothing touches a real database.
 */
export default async function setup(): Promise<() => Promise<void>> {
  const db = await PGlite.create()
  const port = await freePort()
  const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 4 })
  await server.start()

  // pgbouncer=true: PGlite shares one Postgres session between connections,
  // so Prisma mustn't cache prepared statements across them
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?sslmode=disable&connection_limit=1&pgbouncer=true`
  process.env.DATABASE_URL = url
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379' // imported by some modules; never needed by these tests

  // Async on purpose: the database runs in this process, so blocking it
  // (execFileSync) would leave it unable to answer the migration
  await promisify(execFile)(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url },
    shell: process.platform === 'win32',
  })

  return async () => {
    await server.stop()
    await db.close()
  }
}
