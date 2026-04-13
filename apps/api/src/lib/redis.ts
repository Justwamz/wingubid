import Redis from 'ioredis'
import { env } from '../env.js'

let _redis: Redis | null = null

export function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: null })
  }
  return _redis
}
