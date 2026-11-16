// An in-memory Postgres (PGlite) with every Prisma migration applied, for the
// Python job's database tests. Prints {"url": ...} once ready, then serves
// until stdin closes (the test process ending). Needs the backend's
// node_modules (npm ci in the repo root).
import { execFile } from 'node:child_process'
import { createServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const port = await new Promise((ok, fail) => {
  const s = createServer()
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)) })
  s.on('error', fail)
})

const db = await PGlite.create()
const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 4 })
await server.start()

const url = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?sslmode=disable`
await promisify(execFile)(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['prisma', 'migrate', 'deploy'], {
  cwd: repoRoot,
  env: { ...process.env, DATABASE_URL: `${url}&connection_limit=1&pgbouncer=true`, DIRECT_URL: `${url}&connection_limit=1&pgbouncer=true` },
  shell: process.platform === 'win32',
})

process.stdout.write(JSON.stringify({ url }) + '\n')

const stop = async () => { await server.stop(); await db.close(); process.exit(0) }
process.stdin.on('end', stop)
process.stdin.on('close', stop)
process.stdin.resume()
