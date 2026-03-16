import 'dotenv/config'
import Redis from 'ioredis'

if (!process.env.REDIS_URL) {
  throw new Error('REDIS_URL environment variable is not set')
}

export function createRedisConnection(): Redis {
  const client = new Redis(process.env.REDIS_URL as string, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  })
  client.on('error', (err: Error) => console.error('[Redis] Connection error:', err.message))
  return client
}

export const redis = createRedisConnection()

redis.on('connect', () => console.log('[Redis] Connected'))