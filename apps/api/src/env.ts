import { z } from 'zod'

const schema = z.object({
  NODE_ENV:           z.enum(['development', 'test', 'production']).default('development'),
  PORT:               z.coerce.number().default(3001),
  DATABASE_URL:       z.string().min(1),
  REDIS_URL:          z.string().min(1),
  JWT_SECRET:         z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ADMIN_JWT_SECRET:   z.string().min(32),
  SMS_ENABLED:        z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  AT_API_KEY:         z.string().default(''),
  AT_USERNAME:        z.string().default('sandbox'),
  // Shared secret required on inbound payment-provider callbacks. Left empty
  // until a real provider is connected; while empty the webhook routes reject
  // every request (fail closed).
  PAYMENT_WEBHOOK_SECRET: z.string().default(''),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid environment variables:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
