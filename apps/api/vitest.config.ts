import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'test-jwt-secret-must-be-at-least-32-chars-long!!',
      JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-chars-longXXXXX',
      ADMIN_JWT_SECRET: 'test-admin-jwt-secret-at-least-32-chars-longXXX',
      SMS_ENABLED: 'false',
      AT_API_KEY: 'test-at-api-key',
      AT_USERNAME: 'sandbox',
      PORT: '3001',
    },
  },
})
