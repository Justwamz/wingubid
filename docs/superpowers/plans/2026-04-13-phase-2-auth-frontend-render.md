# Phase 2: Auth System, Frontend Scaffold & Render Deployment

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement player and admin authentication end-to-end, scaffold the Next.js web and admin apps with auth UI, set up GitHub Actions CI, and deploy all three services to Render.

**Architecture:** New route/service/lib layers added to `apps/api`. JWT access tokens (15 min) + rotating refresh tokens stored in PostgreSQL. OTP stored in `otp_codes` table. Two JWT secrets: `JWT_SECRET` for players, `ADMIN_JWT_SECRET` for admins. Next.js 14 App Router with client components. Render Blueprint (`render.yaml`) declares all five services.

**Tech Stack:** Node.js 20, TypeScript 5, Fastify 4, `jsonwebtoken`, `bcryptjs`, `africastalking`, `ioredis`, Next.js 14, Tailwind CSS, Vitest, GitHub Actions, Render.

---

## File Map

```
apps/api/src/
├── lib/
│   ├── hash.ts                     # bcrypt hash/compare
│   ├── jwt.ts                      # sign/verify player + admin tokens
│   └── redis.ts                    # ioredis lazy singleton
├── services/
│   ├── otp.service.ts              # generate/verify OTP via otp_codes table
│   ├── sms.service.ts              # Africa's Talking adapter
│   ├── auth.service.ts             # player register/verifyOtp/login/refresh/logout
│   └── admin-auth.service.ts       # admin login/refresh/logout
├── middleware/
│   ├── authenticate.ts             # player JWT preHandler
│   └── authenticate-admin.ts       # admin JWT preHandler
├── routes/
│   ├── health.ts                   # existing
│   ├── auth/
│   │   ├── register.ts             # POST /auth/register
│   │   ├── verify-otp.ts           # POST /auth/verify-otp
│   │   ├── login.ts                # POST /auth/login
│   │   ├── refresh.ts              # POST /auth/refresh
│   │   └── logout.ts               # POST /auth/logout
│   ├── player/
│   │   └── me.ts                   # GET /player/me, POST /player/me/self-exclude
│   └── admin/
│       └── auth.ts                 # POST /admin/auth/login, POST /admin/auth/logout
├── env.ts                          # extend with ADMIN_JWT_SECRET, AT_API_KEY, AT_USERNAME
├── server.ts                       # register new routes
└── vitest.config.ts                # NEW — test env vars

apps/web/
├── src/app/
│   ├── layout.tsx
│   ├── page.tsx                    # redirect → /login
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   ├── register/page.tsx
│   │   └── verify/page.tsx
│   └── (player)/
│       ├── layout.tsx              # auth guard
│       └── dashboard/page.tsx
├── src/lib/
│   ├── api.ts                      # fetch wrapper
│   └── auth.ts                     # token helpers (localStorage)
├── src/app/globals.css
├── next.config.mjs
├── tailwind.config.ts
├── postcss.config.mjs
├── package.json
└── tsconfig.json

apps/admin/
├── src/app/
│   ├── layout.tsx
│   ├── page.tsx                    # redirect → /login
│   ├── login/page.tsx
│   └── dashboard/page.tsx          # auth-protected
├── src/lib/
│   ├── api.ts
│   └── auth.ts
├── src/app/globals.css
├── next.config.mjs
├── tailwind.config.ts
├── postcss.config.mjs
├── package.json
└── tsconfig.json

packages/db/migrations/
└── 009_phone_verified.sql          # ADD COLUMN phone_verified_at

.github/workflows/ci.yml
render.yaml
.env.example                        # add ADMIN_JWT_SECRET, CORS_ORIGIN
```

---

## Task 1: Add migration 009 — phone_verified_at

**Files:**
- Create: `packages/db/migrations/009_phone_verified.sql`

Players must verify their phone via OTP before logging in. We track verification with a nullable timestamp.

- [ ] **Step 1: Create migration file**

```sql
ALTER TABLE players ADD COLUMN phone_verified_at TIMESTAMPTZ;
```

- [ ] **Step 2: Run migrations against local Postgres (Docker must be running)**

```bash
docker compose up -d
pnpm migrate
```

Expected output includes:
```
  apply 009_phone_verified.sql
Migrations complete.
```

- [ ] **Step 3: Commit**

```bash
git add packages/db/migrations/009_phone_verified.sql
git commit -m "feat(db): add phone_verified_at to players"
```

---

## Task 2: Add API dependencies

**Files:**
- Modify: `apps/api/package.json`

- [ ] **Step 1: Add runtime dependencies**

```bash
cd apps/api
pnpm add jsonwebtoken bcryptjs africastalking ioredis
pnpm add -D @types/jsonwebtoken @types/bcryptjs
```

- [ ] **Step 2: Verify installs**

```bash
node -e "require('jsonwebtoken'); require('bcryptjs'); console.log('ok')"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml
git commit -m "chore(api): add jwt, bcrypt, africastalking, ioredis deps"
```

---

## Task 3: vitest.config.ts + extend env.ts

**Files:**
- Create: `apps/api/vitest.config.ts`
- Modify: `apps/api/src/env.ts`
- Modify: `.env.example`

- [ ] **Step 1: Create `apps/api/vitest.config.ts`**

```typescript
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
      AT_API_KEY: 'test-at-api-key',
      AT_USERNAME: 'sandbox',
      PORT: '3001',
    },
  },
})
```

- [ ] **Step 2: Extend `apps/api/src/env.ts`**

Replace the full file content:

```typescript
import { z } from 'zod'

const schema = z.object({
  NODE_ENV:           z.enum(['development', 'test', 'production']).default('development'),
  PORT:               z.coerce.number().default(3001),
  DATABASE_URL:       z.string().min(1),
  REDIS_URL:          z.string().min(1),
  JWT_SECRET:         z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ADMIN_JWT_SECRET:   z.string().min(32),
  AT_API_KEY:         z.string().min(1),
  AT_USERNAME:        z.string().min(1),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid environment variables:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
```

- [ ] **Step 3: Update `.env.example`**

Replace the full file content:

```
# Database
DATABASE_URL=postgresql://betting:betting@localhost:5432/betting_dev

# Redis
REDIS_URL=redis://localhost:6379

# Auth — generate with: openssl rand -base64 64
JWT_SECRET=change_me_in_production
JWT_REFRESH_SECRET=change_me_in_production_too
ADMIN_JWT_SECRET=change_me_in_production_admin

# SMS (Africa's Talking)
AT_USERNAME=sandbox
AT_API_KEY=your_at_api_key

# CORS — set to your web app URL in production
CORS_ORIGIN=http://localhost:3000

# App
NODE_ENV=development
PORT=3001
```

- [ ] **Step 4: Run existing tests to confirm vitest config works**

```bash
cd apps/api && pnpm test
```

Expected: `1 passed`

- [ ] **Step 5: Commit**

```bash
git add apps/api/vitest.config.ts apps/api/src/env.ts .env.example
git commit -m "chore(api): add vitest config and extend env schema"
```

---

## Task 4: lib/hash.ts

**Files:**
- Create: `apps/api/src/lib/hash.ts`
- Create: `apps/api/src/lib/hash.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/lib/hash.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from './hash.js'

describe('hashPassword', () => {
  it('returns a string different from the input', async () => {
    const hash = await hashPassword('secret123')
    expect(hash).not.toBe('secret123')
    expect(hash.startsWith('$2')).toBe(true)
  })
})

describe('verifyPassword', () => {
  it('returns true for correct password', async () => {
    const hash = await hashPassword('secret123')
    expect(await verifyPassword('secret123', hash)).toBe(true)
  })

  it('returns false for wrong password', async () => {
    const hash = await hashPassword('secret123')
    expect(await verifyPassword('wrong', hash)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd apps/api && pnpm test src/lib/hash.test.ts
```

Expected: FAIL — `Cannot find module './hash.js'`

- [ ] **Step 3: Implement `apps/api/src/lib/hash.ts`**

```typescript
import bcrypt from 'bcryptjs'

const ROUNDS = 10

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd apps/api && pnpm test src/lib/hash.test.ts
```

Expected: `3 passed`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/hash.ts apps/api/src/lib/hash.test.ts
git commit -m "feat(api): add bcrypt hash helpers"
```

---

## Task 5: lib/jwt.ts

**Files:**
- Create: `apps/api/src/lib/jwt.ts`
- Create: `apps/api/src/lib/jwt.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/lib/jwt.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  signPlayerAccessToken,
  verifyPlayerAccessToken,
  signAdminAccessToken,
  verifyAdminAccessToken,
} from './jwt.js'

describe('player tokens', () => {
  it('round-trips a player access token', () => {
    const token = signPlayerAccessToken('player-uuid-123')
    const payload = verifyPlayerAccessToken(token)
    expect(payload.sub).toBe('player-uuid-123')
    expect(payload.type).toBe('player_access')
  })

  it('throws on tampered player token', () => {
    const token = signPlayerAccessToken('player-uuid-123')
    expect(() => verifyPlayerAccessToken(token + 'x')).toThrow()
  })
})

describe('admin tokens', () => {
  it('round-trips an admin access token', () => {
    const token = signAdminAccessToken('admin-uuid-456', 'finance')
    const payload = verifyAdminAccessToken(token)
    expect(payload.sub).toBe('admin-uuid-456')
    expect(payload.role).toBe('finance')
    expect(payload.type).toBe('admin_access')
  })

  it('rejects player token as admin token', () => {
    const playerToken = signPlayerAccessToken('player-uuid-123')
    expect(() => verifyAdminAccessToken(playerToken)).toThrow()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd apps/api && pnpm test src/lib/jwt.test.ts
```

Expected: FAIL — `Cannot find module './jwt.js'`

- [ ] **Step 3: Implement `apps/api/src/lib/jwt.ts`**

```typescript
import jwt from 'jsonwebtoken'
import { env } from '../env.js'

export interface PlayerAccessPayload {
  sub: string
  type: 'player_access'
  iat: number
  exp: number
}

export interface AdminAccessPayload {
  sub: string
  role: string
  type: 'admin_access'
  iat: number
  exp: number
}

export function signPlayerAccessToken(playerId: string): string {
  return jwt.sign({ sub: playerId, type: 'player_access' }, env.JWT_SECRET, { expiresIn: '15m' })
}

export function verifyPlayerAccessToken(token: string): PlayerAccessPayload {
  return jwt.verify(token, env.JWT_SECRET) as PlayerAccessPayload
}

export function signAdminAccessToken(adminId: string, role: string): string {
  return jwt.sign({ sub: adminId, role, type: 'admin_access' }, env.ADMIN_JWT_SECRET, { expiresIn: '15m' })
}

export function verifyAdminAccessToken(token: string): AdminAccessPayload {
  return jwt.verify(token, env.ADMIN_JWT_SECRET) as AdminAccessPayload
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd apps/api && pnpm test src/lib/jwt.test.ts
```

Expected: `4 passed`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/jwt.ts apps/api/src/lib/jwt.test.ts
git commit -m "feat(api): add JWT sign/verify helpers"
```

---

## Task 6: lib/redis.ts

**Files:**
- Create: `apps/api/src/lib/redis.ts`

No tests needed — this is a thin wrapper; tested indirectly via services.

- [ ] **Step 1: Create `apps/api/src/lib/redis.ts`**

```typescript
import Redis from 'ioredis'
import { env } from '../env.js'

let _redis: Redis | null = null

export function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: null })
  }
  return _redis
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/lib/redis.ts
git commit -m "feat(api): add ioredis lazy client"
```

---

## Task 7: services/otp.service.ts

**Files:**
- Create: `apps/api/src/services/otp.service.ts`
- Create: `apps/api/src/services/otp.service.test.ts`

OTP is a 6-digit code, stored as a bcrypt hash in `otp_codes`. Expires in 10 minutes.

- [ ] **Step 1: Write the failing test**

`apps/api/src/services/otp.service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the db pool before importing the service
vi.mock('@betting/db', () => ({
  pool: { query: vi.fn() },
}))

// Mock bcrypt so tests are fast
vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn(async (val: string) => `hashed:${val}`),
    compare: vi.fn(async (plain: string, hash: string) => hash === `hashed:${plain}`),
  },
}))

import { pool } from '@betting/db'
import { generateOtp, verifyOtp } from './otp.service.js'

const mockQuery = vi.mocked(pool.query)

beforeEach(() => {
  mockQuery.mockReset()
})

describe('generateOtp', () => {
  it('inserts a hashed OTP and returns the plaintext code', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any)

    const code = await generateOtp('+254700000000', 'registration')

    expect(code).toMatch(/^\d{6}$/)
    expect(mockQuery).toHaveBeenCalledOnce()
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('INSERT INTO otp_codes')
    expect(params[0]).toBe('+254700000000')
    expect(params[2]).toBe('registration')
  })
})

describe('verifyOtp', () => {
  it('returns true and marks OTP used when code matches', async () => {
    // First query: SELECT unexpired, unused OTP
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'otp-uuid', code_hash: 'hashed:123456' }],
    } as any)
    // Second query: UPDATE used_at
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any)

    const result = await verifyOtp('+254700000000', '123456', 'registration')
    expect(result).toBe(true)
    const [updateSql] = mockQuery.mock.calls[1] as [string, unknown[]]
    expect(updateSql).toContain('UPDATE otp_codes')
  })

  it('returns false when no matching OTP exists', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any)
    const result = await verifyOtp('+254700000000', '000000', 'registration')
    expect(result).toBe(false)
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd apps/api && pnpm test src/services/otp.service.test.ts
```

Expected: FAIL — `Cannot find module './otp.service.js'`

- [ ] **Step 3: Implement `apps/api/src/services/otp.service.ts`**

```typescript
import bcrypt from 'bcryptjs'
import { pool } from '@betting/db'

export async function generateOtp(
  phone: string,
  purpose: 'registration' | 'password_reset',
): Promise<string> {
  const code = String(Math.floor(100000 + Math.random() * 900000))
  const codeHash = await bcrypt.hash(code, 10)
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

  await pool.query(
    `INSERT INTO otp_codes (phone, code_hash, purpose, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [phone, codeHash, purpose, expiresAt],
  )

  return code
}

export async function verifyOtp(
  phone: string,
  code: string,
  purpose: 'registration' | 'password_reset',
): Promise<boolean> {
  const { rows } = await pool.query<{ id: string; code_hash: string }>(
    `SELECT id, code_hash FROM otp_codes
     WHERE phone = $1
       AND purpose = $2
       AND used_at IS NULL
       AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1`,
    [phone, purpose],
  )

  if (rows.length === 0) return false

  const match = await bcrypt.compare(code, rows[0].code_hash)
  if (!match) return false

  await pool.query(
    `UPDATE otp_codes SET used_at = NOW() WHERE id = $1`,
    [rows[0].id],
  )

  return true
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd apps/api && pnpm test src/services/otp.service.test.ts
```

Expected: `4 passed`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/otp.service.ts apps/api/src/services/otp.service.test.ts
git commit -m "feat(api): add OTP generate/verify service"
```

---

## Task 8: services/sms.service.ts

**Files:**
- Create: `apps/api/src/services/sms.service.ts`

No automated tests — integration with Africa's Talking is validated manually on staging. The service is mocked in all other tests.

- [ ] **Step 1: Create `apps/api/src/services/sms.service.ts`**

```typescript
import AfricasTalking from 'africastalking'
import { env } from '../env.js'

let _sms: ReturnType<typeof AfricasTalking>['SMS'] | null = null

function getSms() {
  if (!_sms) {
    const at = AfricasTalking({
      apiKey: env.AT_API_KEY,
      username: env.AT_USERNAME,
    })
    _sms = at.SMS
  }
  return _sms
}

export async function sendSms(to: string, message: string): Promise<void> {
  if (env.NODE_ENV === 'test') return

  await getSms().send({ to: [to], message, from: '' })
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/services/sms.service.ts
git commit -m "feat(api): add Africa's Talking SMS adapter"
```

---

## Task 9: services/auth.service.ts

**Files:**
- Create: `apps/api/src/services/auth.service.ts`
- Create: `apps/api/src/services/auth.service.test.ts`

This is the core of Phase 2. All DB operations are explicit SQL — no ORM.

- [ ] **Step 1: Write the failing test**

`apps/api/src/services/auth.service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock client used for transaction tests (registerPlayer uses pool.connect())
const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
}

vi.mock('@betting/db', () => ({
  pool: {
    query: vi.fn(),
    connect: vi.fn(async () => mockClient),
  },
}))
vi.mock('./otp.service.js', () => ({
  generateOtp: vi.fn(async () => '123456'),
  verifyOtp: vi.fn(async () => true),
}))
vi.mock('./sms.service.js', () => ({ sendSms: vi.fn(async () => {}) }))
vi.mock('../lib/hash.js', () => ({
  hashPassword: vi.fn(async (p: string) => `hash:${p}`),
  verifyPassword: vi.fn(async (plain: string, hash: string) => hash === `hash:${plain}`),
}))
vi.mock('../lib/jwt.js', () => ({
  signPlayerAccessToken: vi.fn((id: string) => `access:${id}`),
}))

import { pool } from '@betting/db'
import {
  registerPlayer,
  verifyPlayerOtp,
  loginPlayer,
} from './auth.service.js'

const mockPoolQuery = vi.mocked(pool.query)
const mockClientQuery = vi.mocked(mockClient.query)

beforeEach(() => {
  mockPoolQuery.mockReset()
  mockClientQuery.mockReset()
  mockClient.release.mockReset()
})

describe('registerPlayer', () => {
  it('inserts a player and wallet then sends OTP', async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] } as any)              // BEGIN
      .mockResolvedValueOnce({ rows: [] } as any)              // phone check — not taken
      .mockResolvedValueOnce({ rows: [{ id: 'new-id' }] } as any) // insert player
      .mockResolvedValueOnce({ rows: [] } as any)              // insert wallet
      .mockResolvedValueOnce({ rows: [] } as any)              // COMMIT

    await registerPlayer({
      phone: '+254700000000',
      name: 'Alice',
      country: 'KE',
      currency: 'KES',
      date_of_birth: '1990-01-01',
      password: 'Password1!',
    })

    expect(mockClientQuery).toHaveBeenCalledTimes(5)
    expect(mockClient.release).toHaveBeenCalledOnce()
  })

  it('throws PHONE_TAKEN when phone already exists', async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] } as any)              // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'existing' }] } as any) // phone taken
      .mockResolvedValueOnce({ rows: [] } as any)              // ROLLBACK

    await expect(
      registerPlayer({
        phone: '+254700000000',
        name: 'Alice',
        country: 'KE',
        currency: 'KES',
        date_of_birth: '1990-01-01',
        password: 'Password1!',
      }),
    ).rejects.toMatchObject({ code: 'PHONE_TAKEN' })
  })
})

describe('verifyPlayerOtp', () => {
  it('sets phone_verified_at and returns tokens', async () => {
    // verifyOtp is mocked to return true (module-level mock above)
    // UPDATE players SET phone_verified_at RETURNING id
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 'p1' }] } as any)
    // INSERT INTO refresh_tokens
    mockPoolQuery.mockResolvedValueOnce({ rows: [] } as any)

    const { accessToken } = await verifyPlayerOtp('+254700000000', '123456')
    expect(accessToken).toBe('access:p1')
  })
})

describe('loginPlayer', () => {
  it('returns tokens for valid credentials', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'p1',
        password_hash: 'hash:Password1!',
        phone_verified_at: new Date(),
        status: 'active',
      }],
    } as any)
    mockQuery.mockResolvedValueOnce({ rows: [] } as any) // insert refresh token

    const { accessToken } = await loginPlayer('+254700000000', 'Password1!')
    expect(accessToken).toBe('access:p1')
  })

  it('throws INVALID_CREDENTIALS for wrong password', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'p1',
        password_hash: 'hash:correct',
        phone_verified_at: new Date(),
        status: 'active',
      }],
    } as any)

    await expect(loginPlayer('+254700000000', 'wrong')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    })
  })

  it('throws PHONE_NOT_VERIFIED when OTP was never completed', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'p1',
        password_hash: 'hash:Password1!',
        phone_verified_at: null,
        status: 'active',
      }],
    } as any)

    await expect(loginPlayer('+254700000000', 'Password1!')).rejects.toMatchObject({
      code: 'PHONE_NOT_VERIFIED',
    })
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd apps/api && pnpm test src/services/auth.service.test.ts
```

Expected: FAIL — `Cannot find module './auth.service.js'`

- [ ] **Step 3: Implement `apps/api/src/services/auth.service.ts`**

```typescript
import crypto from 'crypto'
import { pool } from '@betting/db'
import { hashPassword, verifyPassword } from '../lib/hash.js'
import { signPlayerAccessToken } from '../lib/jwt.js'
import { generateOtp, verifyOtp } from './otp.service.js'
import { sendSms } from './sms.service.js'

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 400,
  ) {
    super(message)
  }
}

export interface RegisterInput {
  phone: string
  name: string
  country: string
  currency: string
  date_of_birth: string
  password: string
}

const CURRENCY_BY_COUNTRY: Record<string, string> = {
  KE: 'KES',
  UG: 'UGX',
  TZ: 'TZS',
  RW: 'RWF',
}

export async function registerPlayer(input: RegisterInput): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const existing = await client.query(
      'SELECT id FROM players WHERE phone = $1',
      [input.phone],
    )
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK')
      throw new AppError('PHONE_TAKEN', 'Phone number already registered', 409)
    }

    const passwordHash = await hashPassword(input.password)
    const currency = CURRENCY_BY_COUNTRY[input.country] ?? input.currency

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO players (phone, name, country, currency, date_of_birth, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [input.phone, input.name, input.country, currency, input.date_of_birth, passwordHash],
    )
    const playerId = rows[0].id

    await client.query(
      `INSERT INTO wallets (player_id, currency) VALUES ($1, $2)`,
      [playerId, currency],
    )

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  const code = await generateOtp(input.phone, 'registration')
  await sendSms(input.phone, `Your verification code is ${code}. Valid for 10 minutes.`)
}

export async function verifyPlayerOtp(
  phone: string,
  code: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const valid = await verifyOtp(phone, code, 'registration')
  if (!valid) {
    throw new AppError('INVALID_OTP', 'Invalid or expired OTP', 400)
  }

  const { rows } = await pool.query<{ id: string; phone_verified_at: Date | null }>(
    `UPDATE players SET phone_verified_at = NOW()
     WHERE phone = $1 AND phone_verified_at IS NULL
     RETURNING id`,
    [phone],
  )
  if (rows.length === 0) {
    throw new AppError('INVALID_OTP', 'Invalid or expired OTP', 400)
  }

  const playerId = rows[0].id
  return issueTokens(playerId)
}

export async function loginPlayer(
  phone: string,
  password: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const { rows } = await pool.query<{
    id: string
    password_hash: string
    phone_verified_at: Date | null
    status: string
  }>(
    `SELECT id, password_hash, phone_verified_at, status FROM players WHERE phone = $1`,
    [phone],
  )

  if (rows.length === 0) {
    throw new AppError('INVALID_CREDENTIALS', 'Invalid phone or password', 401)
  }

  const player = rows[0]

  const match = await verifyPassword(password, player.password_hash)
  if (!match) {
    throw new AppError('INVALID_CREDENTIALS', 'Invalid phone or password', 401)
  }

  if (!player.phone_verified_at) {
    throw new AppError('PHONE_NOT_VERIFIED', 'Phone not verified — check your OTP', 403)
  }

  if (player.status === 'suspended') {
    throw new AppError('ACCOUNT_SUSPENDED', 'Account is suspended', 403)
  }

  return issueTokens(player.id)
}

export async function refreshPlayerTokens(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const tokenHash = hashRefreshToken(refreshToken)

  const { rows } = await pool.query<{ id: string; player_id: string; expires_at: Date }>(
    `SELECT id, player_id, expires_at FROM refresh_tokens
     WHERE token_hash = $1`,
    [tokenHash],
  )

  if (rows.length === 0 || rows[0].expires_at < new Date()) {
    throw new AppError('INVALID_REFRESH_TOKEN', 'Invalid or expired refresh token', 401)
  }

  const { id: tokenId, player_id: playerId } = rows[0]

  await pool.query('DELETE FROM refresh_tokens WHERE id = $1', [tokenId])

  return issueTokens(playerId)
}

export async function logoutPlayer(refreshToken: string): Promise<void> {
  const tokenHash = hashRefreshToken(refreshToken)
  await pool.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [tokenHash])
}

async function issueTokens(
  playerId: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const accessToken = signPlayerAccessToken(playerId)

  const refreshToken = crypto.randomUUID()
  const tokenHash = hashRefreshToken(refreshToken)
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

  await pool.query(
    `INSERT INTO refresh_tokens (player_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [playerId, tokenHash, expiresAt],
  )

  return { accessToken, refreshToken }
}

function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd apps/api && pnpm test src/services/auth.service.test.ts
```

Expected: `6 passed`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/auth.service.ts apps/api/src/services/auth.service.test.ts
git commit -m "feat(api): add player auth service"
```

---

## Task 10: services/admin-auth.service.ts

**Files:**
- Create: `apps/api/src/services/admin-auth.service.ts`
- Create: `apps/api/src/services/admin-auth.service.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/services/admin-auth.service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@betting/db', () => ({ pool: { query: vi.fn() } }))
vi.mock('../lib/hash.js', () => ({
  verifyPassword: vi.fn(async (plain: string, hash: string) => hash === `hash:${plain}`),
}))
vi.mock('../lib/jwt.js', () => ({
  signAdminAccessToken: vi.fn((id: string, role: string) => `admin-access:${id}:${role}`),
}))

import { pool } from '@betting/db'
import { loginAdmin } from './admin-auth.service.js'

const mockQuery = vi.mocked(pool.query)

beforeEach(() => mockQuery.mockReset())

describe('loginAdmin', () => {
  it('returns tokens for valid credentials', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'admin-1',
        role: 'finance',
        status: 'active',
        password_hash: 'hash:AdminPass1!',
        name: 'Finance User',
        email: 'finance@example.com',
      }],
    } as any)
    mockQuery.mockResolvedValueOnce({ rows: [] } as any) // insert refresh token

    const result = await loginAdmin('finance@example.com', 'AdminPass1!')
    expect(result.accessToken).toBe('admin-access:admin-1:finance')
    expect(result.admin.role).toBe('finance')
  })

  it('throws INVALID_CREDENTIALS for unknown email', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any)
    await expect(loginAdmin('x@x.com', 'pass')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    })
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd apps/api && pnpm test src/services/admin-auth.service.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement `apps/api/src/services/admin-auth.service.ts`**

```typescript
import crypto from 'crypto'
import { pool } from '@betting/db'
import { verifyPassword } from '../lib/hash.js'
import { signAdminAccessToken } from '../lib/jwt.js'
import { AppError } from './auth.service.js'

export async function loginAdmin(
  email: string,
  password: string,
): Promise<{
  accessToken: string
  refreshToken: string
  admin: { id: string; name: string; email: string; role: string }
}> {
  const { rows } = await pool.query<{
    id: string
    role: string
    status: string
    password_hash: string
    name: string
    email: string
  }>(
    `SELECT id, role, status, password_hash, name, email
     FROM admin_users WHERE email = $1`,
    [email],
  )

  if (rows.length === 0) {
    throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password', 401)
  }

  const admin = rows[0]
  const match = await verifyPassword(password, admin.password_hash)
  if (!match) {
    throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password', 401)
  }

  if (admin.status === 'suspended') {
    throw new AppError('ACCOUNT_SUSPENDED', 'Admin account is suspended', 403)
  }

  const accessToken = signAdminAccessToken(admin.id, admin.role)

  const refreshToken = crypto.randomUUID()
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  await pool.query(
    `INSERT INTO admin_refresh_tokens (admin_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [admin.id, tokenHash, expiresAt],
  )

  return {
    accessToken,
    refreshToken,
    admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
  }
}

export async function logoutAdmin(refreshToken: string): Promise<void> {
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex')
  await pool.query(
    'DELETE FROM admin_refresh_tokens WHERE token_hash = $1',
    [tokenHash],
  )
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd apps/api && pnpm test src/services/admin-auth.service.test.ts
```

Expected: `3 passed`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/admin-auth.service.ts apps/api/src/services/admin-auth.service.test.ts
git commit -m "feat(api): add admin auth service"
```

---

## Task 11: middleware/authenticate.ts + authenticate-admin.ts

**Files:**
- Create: `apps/api/src/middleware/authenticate.ts`
- Create: `apps/api/src/middleware/authenticate-admin.ts`
- Create: `apps/api/src/middleware/authenticate.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/middleware/authenticate.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'

vi.mock('../lib/jwt.js', () => ({
  verifyPlayerAccessToken: vi.fn((token: string) => {
    if (token === 'valid-token') return { sub: 'player-1', type: 'player_access' }
    throw new Error('invalid')
  }),
  verifyAdminAccessToken: vi.fn((token: string) => {
    if (token === 'valid-admin-token') return { sub: 'admin-1', role: 'finance', type: 'admin_access' }
    throw new Error('invalid')
  }),
}))

import { authenticate } from './authenticate.js'
import { authenticateAdmin } from './authenticate-admin.js'

describe('authenticate middleware', () => {
  it('sets request.playerId when token is valid', async () => {
    const app = Fastify()
    app.get('/test', { preHandler: authenticate }, async (req) => {
      return { playerId: (req as any).playerId }
    })
    await app.ready()

    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { authorization: 'Bearer valid-token' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().playerId).toBe('player-1')
  })

  it('returns 401 when no token provided', async () => {
    const app = Fastify()
    app.get('/test', { preHandler: authenticate }, async () => ({ ok: true }))
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/test' })
    expect(res.statusCode).toBe(401)
  })
})

describe('authenticateAdmin middleware', () => {
  it('sets request.adminId and request.adminRole when token is valid', async () => {
    const app = Fastify()
    app.get('/test', { preHandler: authenticateAdmin }, async (req) => ({
      adminId: (req as any).adminId,
      adminRole: (req as any).adminRole,
    }))
    await app.ready()

    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { authorization: 'Bearer valid-admin-token' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().adminId).toBe('admin-1')
    expect(res.json().adminRole).toBe('finance')
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd apps/api && pnpm test src/middleware/authenticate.test.ts
```

Expected: FAIL

- [ ] **Step 3: Create `apps/api/src/middleware/authenticate.ts`**

```typescript
import type { FastifyRequest, FastifyReply } from 'fastify'
import { verifyPlayerAccessToken } from '../lib/jwt.js'

declare module 'fastify' {
  interface FastifyRequest {
    playerId: string
  }
}

export async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Missing token' } })
    return
  }

  try {
    const payload = verifyPlayerAccessToken(header.slice(7))
    req.playerId = payload.sub
  } catch {
    reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } })
  }
}
```

- [ ] **Step 4: Create `apps/api/src/middleware/authenticate-admin.ts`**

```typescript
import type { FastifyRequest, FastifyReply } from 'fastify'
import { verifyAdminAccessToken } from '../lib/jwt.js'

declare module 'fastify' {
  interface FastifyRequest {
    adminId: string
    adminRole: string
  }
}

export async function authenticateAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Missing token' } })
    return
  }

  try {
    const payload = verifyAdminAccessToken(header.slice(7))
    req.adminId = payload.sub
    req.adminRole = payload.role
  } catch {
    reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } })
  }
}
```

- [ ] **Step 5: Run test — expect PASS**

```bash
cd apps/api && pnpm test src/middleware/authenticate.test.ts
```

Expected: `4 passed`

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/middleware/
git commit -m "feat(api): add player and admin auth middleware"
```

---

## Task 12: routes/auth/*

**Files:**
- Create: `apps/api/src/routes/auth/register.ts`
- Create: `apps/api/src/routes/auth/verify-otp.ts`
- Create: `apps/api/src/routes/auth/login.ts`
- Create: `apps/api/src/routes/auth/refresh.ts`
- Create: `apps/api/src/routes/auth/logout.ts`
- Create: `apps/api/src/routes/auth/auth.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/routes/auth/auth.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../services/auth.service.js', () => ({
  AppError: class AppError extends Error {
    constructor(public code: string, message: string, public statusCode = 400) { super(message) }
  },
  registerPlayer: vi.fn(),
  verifyPlayerOtp: vi.fn(),
  loginPlayer: vi.fn(),
  refreshPlayerTokens: vi.fn(),
  logoutPlayer: vi.fn(),
}))

import { buildServer } from '../../server.js'
import * as authService from '../../services/auth.service.js'

const mockRegister = vi.mocked(authService.registerPlayer)
const mockVerify = vi.mocked(authService.verifyPlayerOtp)
const mockLogin = vi.mocked(authService.loginPlayer)

describe('POST /auth/register', () => {
  const app = buildServer()
  afterAll(() => app.close())

  it('returns 201 on valid input', async () => {
    mockRegister.mockResolvedValueOnce(undefined)

    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        phone: '+254700000000',
        name: 'Alice',
        country: 'KE',
        date_of_birth: '1990-01-01',
        password: 'Password1!',
      },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().message).toContain('OTP')
  })

  it('returns 400 when phone is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Alice', country: 'KE', date_of_birth: '1990-01-01', password: 'Password1!' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 409 when phone is taken', async () => {
    const { AppError } = await import('../../services/auth.service.js')
    mockRegister.mockRejectedValueOnce(new AppError('PHONE_TAKEN', 'Phone taken', 409))

    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        phone: '+254700000000',
        name: 'Alice',
        country: 'KE',
        date_of_birth: '1990-01-01',
        password: 'Password1!',
      },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('PHONE_TAKEN')
  })
})

describe('POST /auth/login', () => {
  const app = buildServer()
  afterAll(() => app.close())

  it('returns 200 with access_token on valid credentials', async () => {
    mockLogin.mockResolvedValueOnce({ accessToken: 'tok', refreshToken: 'ref' })

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { phone: '+254700000000', password: 'Password1!' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().access_token).toBe('tok')
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd apps/api && pnpm test src/routes/auth/auth.test.ts
```

Expected: FAIL

- [ ] **Step 3: Create `apps/api/src/routes/auth/register.ts`**

```typescript
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { registerPlayer, AppError } from '../../services/auth.service.js'

const body = z.object({
  phone: z.string().regex(/^\+\d{9,15}$/, 'Must be E.164 format, e.g. +254700000000'),
  name: z.string().min(2),
  country: z.enum(['KE', 'UG', 'TZ', 'RW']),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((dob) => {
    const age = (Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000)
    return age >= 18
  }, 'Must be 18 or older'),
  password: z.string().min(8),
})

export async function registerRoutes(app: FastifyInstance) {
  app.post('/auth/register', async (req, reply) => {
    const parsed = body.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      })
    }

    const country = parsed.data.country
    const currencyMap: Record<string, string> = { KE: 'KES', UG: 'UGX', TZ: 'TZS', RW: 'RWF' }

    try {
      await registerPlayer({ ...parsed.data, currency: currencyMap[country] })
      return reply.status(201).send({ message: `OTP sent to ${parsed.data.phone}` })
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })
}
```

- [ ] **Step 4: Create `apps/api/src/routes/auth/verify-otp.ts`**

```typescript
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { verifyPlayerOtp, AppError } from '../../services/auth.service.js'

const body = z.object({
  phone: z.string().regex(/^\+\d{9,15}$/),
  code: z.string().length(6).regex(/^\d{6}$/),
})

export async function verifyOtpRoutes(app: FastifyInstance) {
  app.post('/auth/verify-otp', async (req, reply) => {
    const parsed = body.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      })
    }

    try {
      const { accessToken, refreshToken } = await verifyPlayerOtp(
        parsed.data.phone,
        parsed.data.code,
      )

      reply.setCookie('refresh_token', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/auth/refresh',
        maxAge: 7 * 24 * 60 * 60,
      })

      return reply.send({ access_token: accessToken })
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })
}
```

- [ ] **Step 5: Create `apps/api/src/routes/auth/login.ts`**

```typescript
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { loginPlayer, AppError } from '../../services/auth.service.js'

const body = z.object({
  phone: z.string().regex(/^\+\d{9,15}$/),
  password: z.string().min(1),
})

export async function loginRoutes(app: FastifyInstance) {
  app.post('/auth/login', async (req, reply) => {
    const parsed = body.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      })
    }

    try {
      const { accessToken, refreshToken } = await loginPlayer(
        parsed.data.phone,
        parsed.data.password,
      )

      reply.setCookie('refresh_token', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/auth/refresh',
        maxAge: 7 * 24 * 60 * 60,
      })

      return reply.send({ access_token: accessToken })
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })
}
```

- [ ] **Step 6: Create `apps/api/src/routes/auth/refresh.ts`**

```typescript
import type { FastifyInstance } from 'fastify'
import { refreshPlayerTokens, AppError } from '../../services/auth.service.js'

export async function refreshRoutes(app: FastifyInstance) {
  app.post('/auth/refresh', async (req, reply) => {
    const refreshToken = req.cookies?.refresh_token
    if (!refreshToken) {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'No refresh token' } })
    }

    try {
      const { accessToken, refreshToken: newRefreshToken } = await refreshPlayerTokens(refreshToken)

      reply.setCookie('refresh_token', newRefreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/auth/refresh',
        maxAge: 7 * 24 * 60 * 60,
      })

      return reply.send({ access_token: accessToken })
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })
}
```

- [ ] **Step 7: Create `apps/api/src/routes/auth/logout.ts`**

```typescript
import type { FastifyInstance } from 'fastify'
import { logoutPlayer } from '../../services/auth.service.js'

export async function logoutRoutes(app: FastifyInstance) {
  app.post('/auth/logout', async (req, reply) => {
    const refreshToken = req.cookies?.refresh_token
    if (refreshToken) {
      await logoutPlayer(refreshToken)
    }

    reply.clearCookie('refresh_token', { path: '/auth/refresh' })
    return reply.status(204).send()
  })
}
```

- [ ] **Step 8: Run test — expect PASS (after wiring routes in server.ts in next task)**

Defer running auth tests until after server.ts is updated (Task 14).

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/routes/auth/
git commit -m "feat(api): add player auth routes (register, verify-otp, login, refresh, logout)"
```

---

## Task 13: routes/admin/auth.ts + routes/player/me.ts

**Files:**
- Create: `apps/api/src/routes/admin/auth.ts`
- Create: `apps/api/src/routes/player/me.ts`

- [ ] **Step 1: Create `apps/api/src/routes/admin/auth.ts`**

```typescript
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { loginAdmin, logoutAdmin } from '../../services/admin-auth.service.js'
import { AppError } from '../../services/auth.service.js'

const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export async function adminAuthRoutes(app: FastifyInstance) {
  app.post('/admin/auth/login', async (req, reply) => {
    const parsed = loginBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      })
    }

    try {
      const { accessToken, refreshToken, admin } = await loginAdmin(
        parsed.data.email,
        parsed.data.password,
      )

      reply.setCookie('admin_refresh_token', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/admin/auth/refresh',
        maxAge: 7 * 24 * 60 * 60,
      })

      return reply.send({ access_token: accessToken, admin })
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })

  app.post('/admin/auth/logout', async (req, reply) => {
    const refreshToken = req.cookies?.admin_refresh_token
    if (refreshToken) {
      await logoutAdmin(refreshToken)
    }
    reply.clearCookie('admin_refresh_token', { path: '/admin/auth/refresh' })
    return reply.status(204).send()
  })
}
```

- [ ] **Step 2: Create `apps/api/src/routes/player/me.ts`**

```typescript
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'
import { authenticate } from '../../middleware/authenticate.js'
import { AppError } from '../../services/auth.service.js'

const selfExcludeBody = z.object({
  period: z.enum(['7d', '30d', '90d', 'permanent']),
})

const PERIOD_DAYS: Record<string, number | null> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  permanent: null,
}

export async function playerMeRoutes(app: FastifyInstance) {
  app.get('/player/me', { preHandler: authenticate }, async (req, reply) => {
    const { rows } = await pool.query<{
      id: string; name: string; phone: string; country: string
      currency: string; status: string; created_at: string
      balance: string; bonus_balance: string; locked_balance: string
    }>(
      `SELECT p.id, p.name, p.phone, p.country, p.currency, p.status, p.created_at,
              w.balance, w.bonus_balance, w.locked_balance
       FROM players p
       JOIN wallets w ON w.player_id = p.id
       WHERE p.id = $1`,
      [req.playerId],
    )

    if (rows.length === 0) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Player not found' } })
    }

    const p = rows[0]
    return reply.send({
      id: p.id,
      name: p.name,
      phone: p.phone,
      country: p.country,
      currency: p.currency,
      status: p.status,
      created_at: p.created_at,
      wallet: {
        balance: Number(p.balance),
        bonus_balance: Number(p.bonus_balance),
        locked_balance: Number(p.locked_balance),
      },
    })
  })

  app.post('/player/me/self-exclude', { preHandler: authenticate }, async (req, reply) => {
    const parsed = selfExcludeBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      })
    }

    const days = PERIOD_DAYS[parsed.data.period]
    const excludedUntil = days
      ? new Date(Date.now() + days * 24 * 60 * 60 * 1000)
      : null // permanent = no end date

    await pool.query(
      `UPDATE players
       SET status = 'self_excluded', self_excluded_until = $2
       WHERE id = $1`,
      [req.playerId, excludedUntil],
    )

    return reply.send({ message: 'Self-exclusion applied' })
  })
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/admin/ apps/api/src/routes/player/
git commit -m "feat(api): add admin auth routes and player/me routes"
```

---

## Task 14: Update server.ts — register all routes

**Files:**
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Replace `apps/api/src/server.ts`**

```typescript
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import { healthRoutes } from './routes/health.js'
import { registerRoutes } from './routes/auth/register.js'
import { verifyOtpRoutes } from './routes/auth/verify-otp.js'
import { loginRoutes } from './routes/auth/login.js'
import { refreshRoutes } from './routes/auth/refresh.js'
import { logoutRoutes } from './routes/auth/logout.js'
import { adminAuthRoutes } from './routes/admin/auth.js'
import { playerMeRoutes } from './routes/player/me.js'

export function buildServer() {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' })

  app.register(cors, {
    origin: process.env.CORS_ORIGIN ?? true,
    credentials: true,
  })
  app.register(cookie)
  app.register(healthRoutes)
  app.register(registerRoutes)
  app.register(verifyOtpRoutes)
  app.register(loginRoutes)
  app.register(refreshRoutes)
  app.register(logoutRoutes)
  app.register(adminAuthRoutes)
  app.register(playerMeRoutes)

  app.setErrorHandler((error, _req, reply) => {
    const statusCode = error.statusCode ?? 500
    reply.status(statusCode).send({
      error: {
        code: error.code ?? 'INTERNAL_ERROR',
        message: statusCode >= 500 ? 'Internal server error' : error.message,
      },
    })
  })

  return app
}
```

- [ ] **Step 2: Run all tests**

```bash
cd apps/api && pnpm test
```

Expected: all tests pass including the deferred auth route tests from Task 12.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/server.ts
git commit -m "feat(api): register all auth routes in server"
```

---

## Task 15: apps/web scaffold

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/next.config.mjs`
- Create: `apps/web/tailwind.config.ts`
- Create: `apps/web/postcss.config.mjs`
- Create: `apps/web/src/app/globals.css`
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/lib/auth.ts`

- [ ] **Step 1: Create `apps/web/package.json`**

```json
{
  "name": "web",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start -p 3000"
  },
  "dependencies": {
    "@betting/types": "workspace:*",
    "next": "^14.2.5",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.38",
    "tailwindcss": "^3.4.4",
    "typescript": "^5.4.5"
  }
}
```

- [ ] **Step 2: Create `apps/web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `apps/web/next.config.mjs`**

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
}

export default nextConfig
```

- [ ] **Step 4: Create `apps/web/tailwind.config.ts`**

```typescript
import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
}

export default config
```

- [ ] **Step 5: Create `apps/web/postcss.config.mjs`**

```javascript
const config = {
  plugins: { tailwindcss: {}, autoprefixer: {} },
}

export default config
```

- [ ] **Step 6: Create `apps/web/src/app/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 7: Create `apps/web/src/app/layout.tsx`**

```tsx
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Wingu Bet',
  description: 'Online betting platform',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-950 text-white">{children}</body>
    </html>
  )
}
```

- [ ] **Step 8: Create `apps/web/src/lib/api.ts`**

```typescript
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<{ data?: T; error?: { code: string; message: string } }> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })

  const json = await res.json()
  if (!res.ok) return { error: json.error }
  return { data: json as T }
}
```

- [ ] **Step 9: Create `apps/web/src/lib/auth.ts`**

```typescript
export function saveToken(token: string) {
  localStorage.setItem('access_token', token)
}

export function getToken(): string | null {
  return localStorage.getItem('access_token')
}

export function clearToken() {
  localStorage.removeItem('access_token')
}

export function isAuthenticated(): boolean {
  const token = getToken()
  if (!token) return false
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    return payload.exp * 1000 > Date.now()
  } catch {
    return false
  }
}
```

- [ ] **Step 10: Install deps**

```bash
cd apps/web && pnpm install
```

- [ ] **Step 11: Commit**

```bash
git add apps/web/
git commit -m "feat(web): scaffold Next.js 14 player app"
```

---

## Task 16: apps/web auth pages

**Files:**
- Create: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/app/(auth)/login/page.tsx`
- Create: `apps/web/src/app/(auth)/register/page.tsx`
- Create: `apps/web/src/app/(auth)/verify/page.tsx`
- Create: `apps/web/src/app/(player)/layout.tsx`
- Create: `apps/web/src/app/(player)/dashboard/page.tsx`

- [ ] **Step 1: Create `apps/web/src/app/page.tsx`**

```tsx
'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { isAuthenticated } from '@/lib/auth'

export default function Home() {
  const router = useRouter()
  useEffect(() => {
    router.replace(isAuthenticated() ? '/dashboard' : '/login')
  }, [router])
  return null
}
```

- [ ] **Step 2: Create `apps/web/src/app/(auth)/login/page.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import { saveToken } from '@/lib/auth'

export default function LoginPage() {
  const router = useRouter()
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { data, error: err } = await apiFetch<{ access_token: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone, password }),
    })
    setLoading(false)
    if (err) { setError(err.message); return }
    saveToken(data!.access_token)
    router.push('/dashboard')
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-8 text-3xl font-bold text-center">Wingu Bet</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Phone</label>
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="+254700000000"
              className="w-full rounded bg-gray-800 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-emerald-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full rounded bg-gray-800 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-emerald-500"
              required
            />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-emerald-600 py-2 font-semibold hover:bg-emerald-500 disabled:opacity-50"
          >
            {loading ? 'Logging in…' : 'Log in'}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-gray-400">
          No account?{' '}
          <Link href="/register" className="text-emerald-400 hover:underline">Register</Link>
        </p>
      </div>
    </main>
  )
}
```

- [ ] **Step 3: Create `apps/web/src/app/(auth)/register/page.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'

export default function RegisterPage() {
  const router = useRouter()
  const [form, setForm] = useState({
    phone: '', name: '', country: 'KE', date_of_birth: '', password: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function update(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [field]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error: err } = await apiFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify(form),
    })
    setLoading(false)
    if (err) { setError(err.message); return }
    router.push(`/verify?phone=${encodeURIComponent(form.phone)}`)
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-8 text-3xl font-bold text-center">Create Account</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          {([
            ['phone', 'tel', 'Phone (+254700000000)', 'phone'],
            ['name', 'text', 'Full name', 'name'],
            ['date_of_birth', 'date', 'Date of birth', 'date_of_birth'],
            ['password', 'password', 'Password (min 8 chars)', 'password'],
          ] as [keyof typeof form, string, string, string][]).map(([field, type, placeholder]) => (
            <div key={field}>
              <label className="block text-sm text-gray-400 mb-1">{placeholder}</label>
              <input
                type={type}
                value={form[field]}
                onChange={update(field)}
                placeholder={type !== 'date' && type !== 'password' ? placeholder : undefined}
                className="w-full rounded bg-gray-800 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-emerald-500"
                required
              />
            </div>
          ))}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Country</label>
            <select
              value={form.country}
              onChange={update('country')}
              className="w-full rounded bg-gray-800 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="KE">Kenya</option>
              <option value="UG">Uganda</option>
              <option value="TZ">Tanzania</option>
              <option value="RW">Rwanda</option>
            </select>
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-emerald-600 py-2 font-semibold hover:bg-emerald-500 disabled:opacity-50"
          >
            {loading ? 'Registering…' : 'Register'}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-gray-400">
          Have an account?{' '}
          <Link href="/login" className="text-emerald-400 hover:underline">Log in</Link>
        </p>
      </div>
    </main>
  )
}
```

- [ ] **Step 4: Create `apps/web/src/app/(auth)/verify/page.tsx`**

```tsx
'use client'
import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import { saveToken } from '@/lib/auth'

function VerifyForm() {
  const router = useRouter()
  const params = useSearchParams()
  const phone = params.get('phone') ?? ''
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { data, error: err } = await apiFetch<{ access_token: string }>('/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ phone, code }),
    })
    setLoading(false)
    if (err) { setError(err.message); return }
    saveToken(data!.access_token)
    router.push('/dashboard')
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-4 text-2xl font-bold text-center">Verify your phone</h1>
        <p className="mb-8 text-center text-gray-400 text-sm">
          Enter the 6-digit code sent to {phone}
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="123456"
            className="w-full rounded bg-gray-800 px-3 py-3 text-center text-2xl tracking-widest text-white outline-none focus:ring-2 focus:ring-emerald-500"
            required
          />
          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          <button
            type="submit"
            disabled={loading || code.length !== 6}
            className="w-full rounded bg-emerald-600 py-2 font-semibold hover:bg-emerald-500 disabled:opacity-50"
          >
            {loading ? 'Verifying…' : 'Verify'}
          </button>
        </form>
      </div>
    </main>
  )
}

export default function VerifyPage() {
  return <Suspense><VerifyForm /></Suspense>
}
```

- [ ] **Step 5: Create `apps/web/src/app/(player)/layout.tsx`**

```tsx
'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { isAuthenticated } from '@/lib/auth'

export default function PlayerLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  useEffect(() => {
    if (!isAuthenticated()) router.replace('/login')
  }, [router])
  return <>{children}</>
}
```

- [ ] **Step 6: Create `apps/web/src/app/(player)/dashboard/page.tsx`**

```tsx
'use client'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { clearToken } from '@/lib/auth'
import { useRouter } from 'next/navigation'

interface PlayerProfile {
  name: string
  phone: string
  country: string
  currency: string
  wallet: { balance: number; bonus_balance: number }
}

export default function DashboardPage() {
  const router = useRouter()
  const [player, setPlayer] = useState<PlayerProfile | null>(null)

  useEffect(() => {
    apiFetch<PlayerProfile>('/player/me').then(({ data }) => {
      if (data) setPlayer(data)
    })
  }, [])

  function handleLogout() {
    apiFetch('/auth/logout', { method: 'POST' })
    clearToken()
    router.push('/login')
  }

  if (!player) return <p className="p-8 text-gray-400">Loading…</p>

  return (
    <main className="p-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">Welcome, {player.name}</h1>
        <button
          onClick={handleLogout}
          className="rounded bg-gray-700 px-4 py-2 text-sm hover:bg-gray-600"
        >
          Log out
        </button>
      </div>
      <div className="grid grid-cols-2 gap-4 max-w-md">
        <div className="rounded-lg bg-gray-800 p-4">
          <p className="text-sm text-gray-400">Balance</p>
          <p className="text-2xl font-bold mt-1">
            {player.currency} {(player.wallet.balance / 100).toFixed(2)}
          </p>
        </div>
        <div className="rounded-lg bg-gray-800 p-4">
          <p className="text-sm text-gray-400">Bonus</p>
          <p className="text-2xl font-bold mt-1">
            {player.currency} {(player.wallet.bonus_balance / 100).toFixed(2)}
          </p>
        </div>
      </div>
    </main>
  )
}
```

- [ ] **Step 7: Verify web app builds**

```bash
cd apps/web && pnpm build
```

Expected: Build completes with no TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/
git commit -m "feat(web): add auth pages (login, register, verify, dashboard)"
```

---

## Task 17: apps/admin scaffold + auth pages

**Files:**
- Create: `apps/admin/package.json`
- Create: `apps/admin/tsconfig.json`
- Create: `apps/admin/next.config.mjs`
- Create: `apps/admin/tailwind.config.ts`
- Create: `apps/admin/postcss.config.mjs`
- Create: `apps/admin/src/app/globals.css`
- Create: `apps/admin/src/app/layout.tsx`
- Create: `apps/admin/src/app/page.tsx`
- Create: `apps/admin/src/app/login/page.tsx`
- Create: `apps/admin/src/app/dashboard/page.tsx`
- Create: `apps/admin/src/lib/api.ts`
- Create: `apps/admin/src/lib/auth.ts`

- [ ] **Step 1: Create `apps/admin/package.json`**

```json
{
  "name": "admin",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3002",
    "build": "next build",
    "start": "next start -p 3002"
  },
  "dependencies": {
    "@betting/types": "workspace:*",
    "next": "^14.2.5",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.38",
    "tailwindcss": "^3.4.4",
    "typescript": "^5.4.5"
  }
}
```

- [ ] **Step 2: Create `apps/admin/tsconfig.json`**

Same as `apps/web/tsconfig.json` — copy exactly.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create config files (next.config, tailwind, postcss, globals.css)**

`apps/admin/next.config.mjs` — identical to web:
```javascript
/** @type {import('next').NextConfig} */
const nextConfig = { output: 'standalone' }
export default nextConfig
```

`apps/admin/tailwind.config.ts` — identical to web:
```typescript
import type { Config } from 'tailwindcss'
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
}
export default config
```

`apps/admin/postcss.config.mjs` — identical to web:
```javascript
const config = { plugins: { tailwindcss: {}, autoprefixer: {} } }
export default config
```

`apps/admin/src/app/globals.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 4: Create `apps/admin/src/app/layout.tsx`**

```tsx
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Wingu Bet Admin',
  description: 'Back-office',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-950 text-white">{children}</body>
    </html>
  )
}
```

- [ ] **Step 5: Create `apps/admin/src/lib/api.ts`**

```typescript
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<{ data?: T; error?: { code: string; message: string } }> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('admin_access_token') : null

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })

  const json = await res.json()
  if (!res.ok) return { error: json.error }
  return { data: json as T }
}
```

- [ ] **Step 6: Create `apps/admin/src/lib/auth.ts`**

```typescript
export function saveToken(token: string) {
  localStorage.setItem('admin_access_token', token)
}

export function getToken(): string | null {
  return localStorage.getItem('admin_access_token')
}

export function clearToken() {
  localStorage.removeItem('admin_access_token')
}

export function isAuthenticated(): boolean {
  const token = getToken()
  if (!token) return false
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    return payload.exp * 1000 > Date.now()
  } catch {
    return false
  }
}
```

- [ ] **Step 7: Create `apps/admin/src/app/page.tsx`**

```tsx
'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { isAuthenticated } from '@/lib/auth'

export default function Home() {
  const router = useRouter()
  useEffect(() => {
    router.replace(isAuthenticated() ? '/dashboard' : '/login')
  }, [router])
  return null
}
```

- [ ] **Step 8: Create `apps/admin/src/app/login/page.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import { saveToken } from '@/lib/auth'

interface LoginResponse {
  access_token: string
  admin: { name: string; role: string }
}

export default function AdminLoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { data, error: err } = await apiFetch<LoginResponse>('/admin/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
    setLoading(false)
    if (err) { setError(err.message); return }
    saveToken(data!.access_token)
    router.push('/dashboard')
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-2 text-3xl font-bold text-center">Admin</h1>
        <p className="mb-8 text-center text-gray-400 text-sm">Back-office login</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full rounded bg-gray-800 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full rounded bg-gray-800 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-blue-600 py-2 font-semibold hover:bg-blue-500 disabled:opacity-50"
          >
            {loading ? 'Logging in…' : 'Log in'}
          </button>
        </form>
      </div>
    </main>
  )
}
```

- [ ] **Step 9: Create `apps/admin/src/app/dashboard/page.tsx`**

```tsx
'use client'
import { useEffect, useState } from 'react'
import { isAuthenticated, clearToken } from '@/lib/auth'
import { useRouter } from 'next/navigation'

export default function AdminDashboardPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace('/login')
    } else {
      setReady(true)
    }
  }, [router])

  function handleLogout() {
    clearToken()
    router.push('/login')
  }

  if (!ready) return null

  return (
    <main className="p-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">Admin Dashboard</h1>
        <button
          onClick={handleLogout}
          className="rounded bg-gray-700 px-4 py-2 text-sm hover:bg-gray-600"
        >
          Log out
        </button>
      </div>
      <p className="text-gray-400">Welcome to the back-office. More features coming in Phase 3.</p>
    </main>
  )
}
```

- [ ] **Step 10: Install deps and build**

```bash
cd apps/admin && pnpm install && pnpm build
```

Expected: Build completes with no errors.

- [ ] **Step 11: Commit**

```bash
git add apps/admin/
git commit -m "feat(admin): scaffold Next.js 14 admin app with login + dashboard"
```

---

## Task 18: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

jobs:
  test:
    name: Test & Build
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: betting
          POSTGRES_PASSWORD: betting
          POSTGRES_DB: betting_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v3
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build packages
        run: |
          pnpm --filter @betting/types build
          pnpm --filter @betting/db build

      - name: Run API tests
        run: pnpm --filter api test

      - name: Build API
        run: pnpm --filter api build

      - name: Build web
        run: pnpm --filter web build

      - name: Build admin
        run: pnpm --filter admin build
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions CI pipeline"
```

---

## Task 19: Render deployment (render.yaml)

**Files:**
- Create: `render.yaml`

Render Blueprint spec: declares all five services. Environment variables with `sync: false` must be manually set in the Render dashboard (secrets that can't be committed).

- [ ] **Step 1: Create `render.yaml`**

```yaml
services:
  # ── Redis ──────────────────────────────────────────────────────────────
  - type: redis
    name: betting-redis
    plan: starter
    ipAllowList: []

  # ── API ────────────────────────────────────────────────────────────────
  - type: web
    name: betting-api
    env: node
    plan: starter
    rootDir: .
    buildCommand: >
      npm install -g pnpm &&
      pnpm install --frozen-lockfile &&
      pnpm --filter @betting/types build &&
      pnpm --filter @betting/db build &&
      pnpm --filter api build
    startCommand: node apps/api/dist/index.js
    healthCheckPath: /health
    envVars:
      - key: NODE_ENV
        value: production
      - key: DATABASE_URL
        fromDatabase:
          name: betting-db
          property: connectionString
      - key: REDIS_URL
        fromService:
          type: redis
          name: betting-redis
          property: connectionString
      - key: JWT_SECRET
        generateValue: true
      - key: JWT_REFRESH_SECRET
        generateValue: true
      - key: ADMIN_JWT_SECRET
        generateValue: true
      - key: AT_API_KEY
        sync: false   # set manually in Render dashboard
      - key: AT_USERNAME
        sync: false   # set manually in Render dashboard
      - key: CORS_ORIGIN
        value: https://betting-web.onrender.com
      - key: PORT
        value: 10000

  # ── Web (player app) ───────────────────────────────────────────────────
  - type: web
    name: betting-web
    env: node
    plan: starter
    rootDir: .
    buildCommand: >
      npm install -g pnpm &&
      pnpm install --frozen-lockfile &&
      pnpm --filter @betting/types build &&
      pnpm --filter web build
    startCommand: pnpm --filter web start
    envVars:
      - key: NEXT_PUBLIC_API_URL
        value: https://betting-api.onrender.com
      - key: PORT
        value: 3000

  # ── Admin ──────────────────────────────────────────────────────────────
  - type: web
    name: betting-admin
    env: node
    plan: starter
    rootDir: .
    buildCommand: >
      npm install -g pnpm &&
      pnpm install --frozen-lockfile &&
      pnpm --filter @betting/types build &&
      pnpm --filter admin build
    startCommand: pnpm --filter admin start
    envVars:
      - key: NEXT_PUBLIC_API_URL
        value: https://betting-api.onrender.com
      - key: PORT
        value: 3002

databases:
  - name: betting-db
    databaseName: betting
    user: betting
    plan: starter
```

- [ ] **Step 2: Update `.gitignore` to add `.next`**

Confirm `.next/` is already in `.gitignore`:

```bash
grep -c '\.next' .gitignore
```

Expected: `1`. If `0`, add `.next/` to `.gitignore`.

- [ ] **Step 3: Commit render.yaml**

```bash
git add render.yaml
git commit -m "feat: add Render Blueprint for 5-service deployment"
```

- [ ] **Step 4: Create the Render project via Dashboard (manual step)**

1. Go to [render.com](https://render.com) → New → Blueprint
2. Connect your GitHub repo
3. Render detects `render.yaml` and previews all five services
4. Set the two manual env vars on `betting-api`:
   - `AT_API_KEY` → your Africa's Talking API key
   - `AT_USERNAME` → your Africa's Talking username (use `sandbox` for staging)
5. Click **Apply** — Render creates and begins building all services

- [ ] **Step 5: Run database migrations on Render**

After all services are deployed and `betting-api` is healthy:

```bash
# Open the Render Shell for betting-api, then run:
DATABASE_URL=$DATABASE_URL node -e "
  require('./apps/api/dist/index.js')
" 
# OR use the one-off job approach:
# In Render Dashboard → betting-api → Shell:
node -e "process.env.DATABASE_URL" # confirm URL is set
```

Actually, run migrations via the Render Shell on betting-api:

```bash
# In Render Dashboard → betting-api → Shell tab:
cd /opt/render/project/src
node packages/db/dist/migrate.js
```

Expected output:
```
  apply 001_players.sql
  apply 002_auth.sql
  ...
  apply 009_phone_verified.sql
Migrations complete.
```

- [ ] **Step 6: Smoke-test the deployed API**

```bash
curl https://betting-api.onrender.com/health
```

Expected: `{"status":"ok"}`

---

## Post-Deployment Checklist

- [ ] `https://betting-api.onrender.com/health` returns `{"status":"ok"}`
- [ ] `https://betting-web.onrender.com` loads the login page
- [ ] `https://betting-admin.onrender.com` loads the admin login page
- [ ] Register a test player via the web app (use Africa's Talking sandbox — OTP is logged in the AT dashboard, not actually sent)
- [ ] Verify OTP and confirm redirect to dashboard
- [ ] Log in with the registered player credentials
- [ ] Confirm GitHub Actions CI passes on the next push to `main`
