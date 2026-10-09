import { defineConfig } from 'vitest/config'

// Database tests: a real (in-memory) Postgres is started for the run, all
// migrations are applied, and the services and HTTP routes run against it.
// Separate from `npm test` so the everyday suite stays fast and needs no database.
export default defineConfig({
  test: {
    include: ['test/db/**/*.db.test.ts'],
    environment: 'node',
    globalSetup: ['test/db/globalSetup.ts'],
    fileParallelism: false, // one database, shared by every file
    testTimeout: 120_000,
    hookTimeout: 120_000,
    env: {
      APP_TIMEZONE: 'Africa/Nairobi',
      NODE_ENV: 'test',
      JWT_ACCESS_SECRET: 'db-test-access-secret',
      JWT_REFRESH_SECRET: 'db-test-refresh-secret',
      SESSION_SECRET: 'db-test-session-secret-that-is-long-enough',
    },
  },
})
