import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/db/**'], // need a database: npm run test:db
    environment: 'node',
    // Day boundaries depend on this — pin it so tests match production
    env: { APP_TIMEZONE: 'Africa/Nairobi' },
  },
})
