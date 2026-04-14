import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://betting:betting@localhost:5432/betting',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'test-secret-minimum-32-characters-long',
      JWT_REFRESH_SECRET: 'test-refresh-secret-minimum-32-chars',
      DATABASE_SSL: 'false',
    },
  },
})
