import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Day boundaries depend on this — pin it so tests match production
    env: { APP_TIMEZONE: 'Africa/Nairobi' },
  },
})
