# Betting Platform — Phase 1: Foundation & Database Schema

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the monorepo, define the complete database schema via migrations, and get all three apps (api, web, admin) booting with a working health check endpoint.

**Architecture:** pnpm monorepo with `apps/api` (Fastify), `apps/web` (Next.js 14), `apps/admin` (Next.js 14), `packages/db` (pg client + migration runner), `packages/types` (shared TypeScript types). Local dev uses Docker Compose for PostgreSQL 16 and Redis 7.

**Tech Stack:** Node.js 20, TypeScript 5, pnpm 9, Fastify 4, Next.js 14, PostgreSQL 16, Redis 7, `pg`, `bcrypt`, `zod`, Docker Compose, GitHub Actions, Vitest.

---

## File Map

```
betting-platform/
├── .github/
│   └── workflows/
│       └── ci.yml
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── server.ts          # Fastify instance + plugin registration
│   │   │   ├── index.ts           # Entry point — binds server to port
│   │   │   ├── env.ts             # Zod env validation
│   │   │   └── routes/
│   │   │       └── health.ts      # GET /health
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── web/
│   │   ├── src/app/
│   │   │   ├── layout.tsx         # Root layout
│   │   │   └── page.tsx           # Placeholder home page
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── admin/
│       ├── src/app/
│       │   ├── layout.tsx         # Root layout
│       │   └── page.tsx           # Placeholder admin page
│       ├── package.json
│       └── tsconfig.json
├── packages/
│   ├── types/
│   │   ├── src/
│   │   │   ├── index.ts           # Re-exports all types
│   │   │   ├── player.ts
│   │   │   ├── wallet.ts
│   │   │   ├── transaction.ts
│   │   │   ├── bet.ts
│   │   │   ├── game.ts
│   │   │   ├── tax.ts
│   │   │   ├── admin.ts
│   │   │   └── settings.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── db/
│       ├── src/
│       │   ├── client.ts          # pg Pool export
│       │   ├── migrate.ts         # Migration runner CLI
│       │   └── index.ts           # Re-exports client
│       ├── migrations/
│       │   ├── 001_players.sql
│       │   ├── 002_auth.sql
│       │   ├── 003_wallets.sql
│       │   ├── 004_transactions.sql
│       │   ├── 005_tax.sql
│       │   ├── 006_games.sql
│       │   ├── 007_admin.sql
│       │   └── 008_settings.sql
│       ├── package.json
│       └── tsconfig.json
├── docker-compose.yml
├── .env.example
├── package.json                   # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── .npmrc
```

---

## Task 1: Initialise the monorepo root

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `.npmrc`
- Create: `tsconfig.base.json`
- Create: `.gitignore`

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "betting-platform",
  "private": true,
  "version": "0.0.1",
  "engines": { "node": ">=20", "pnpm": ">=9" },
  "scripts": {
    "dev:api": "pnpm --filter api dev",
    "dev:web": "pnpm --filter web dev",
    "dev:admin": "pnpm --filter admin dev",
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "migrate": "pnpm --filter @betting/db migrate"
  },
  "devDependencies": {
    "typescript": "^5.4.5"
  }
}
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

- [ ] **Step 3: Create `.npmrc`**

```
shamefully-hoist=true
strict-peer-dependencies=false
```

`shamefully-hoist=true` is required for Next.js to resolve dependencies correctly in a monorepo.

- [ ] **Step 4: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 5: Create `.gitignore`**

```
node_modules/
.env
.env.local
dist/
.next/
*.tsbuildinfo
```

- [ ] **Step 6: Commit**

```bash
git init
git add package.json pnpm-workspace.yaml .npmrc tsconfig.base.json .gitignore
git commit -m "chore: init monorepo root"
```

---

## Task 2: Create `packages/types`

**Files:**
- Create: `packages/types/package.json`
- Create: `packages/types/tsconfig.json`
- Create: `packages/types/src/player.ts`
- Create: `packages/types/src/wallet.ts`
- Create: `packages/types/src/transaction.ts`
- Create: `packages/types/src/bet.ts`
- Create: `packages/types/src/game.ts`
- Create: `packages/types/src/tax.ts`
- Create: `packages/types/src/admin.ts`
- Create: `packages/types/src/settings.ts`
- Create: `packages/types/src/index.ts`

- [ ] **Step 1: Create `packages/types/package.json`**

```json
{
  "name": "@betting/types",
  "version": "0.0.1",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "devDependencies": {
    "typescript": "^5.4.5"
  }
}
```

- [ ] **Step 2: Create `packages/types/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/types/src/player.ts`**

```typescript
export type PlayerStatus = 'active' | 'suspended' | 'self_excluded'

export interface Player {
  id: string
  phone: string
  name: string
  country: string        // ISO 3166-1 alpha-2 e.g. 'KE'
  currency: string       // ISO 4217 e.g. 'KES'
  date_of_birth: string  // YYYY-MM-DD
  status: PlayerStatus
  self_excluded_until: string | null
  created_at: string
}

export interface CreatePlayerInput {
  phone: string
  name: string
  country: string
  currency: string
  date_of_birth: string
  password: string
}
```

- [ ] **Step 4: Create `packages/types/src/wallet.ts`**

```typescript
export interface Wallet {
  id: string
  player_id: string
  currency: string
  balance: number          // integer, smallest unit (e.g. cents)
  bonus_balance: number
  locked_balance: number
}
```

- [ ] **Step 5: Create `packages/types/src/transaction.ts`**

```typescript
export type TransactionType =
  | 'deposit'
  | 'withdrawal'
  | 'bet_placed'
  | 'bet_won'
  | 'bet_refunded'
  | 'bonus_credit'
  | 'bonus_wager'
  | 'wager_tax'
  | 'withdrawal_tax'

export type TransactionStatus = 'pending' | 'completed' | 'failed'

export interface Transaction {
  id: string
  wallet_id: string
  player_id: string
  type: TransactionType
  amount: number           // positive = credit, negative = debit
  balance_after: number
  status: TransactionStatus
  reference: string | null  // external payment reference
  idempotency_key: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}
```

- [ ] **Step 6: Create `packages/types/src/bet.ts`**

```typescript
export type BetStatus = 'active' | 'won' | 'lost' | 'refunded'
export type GameType = 'crash' | 'slot' | 'virtual_sport'

export interface Bet {
  id: string
  player_id: string
  wallet_id: string
  round_id: string | null  // null for provider (slot/virtual) bets
  game_type: GameType
  gross_stake: number      // amount player entered
  wager_tax: number        // tax deducted from gross_stake
  effective_stake: number  // gross_stake - wager_tax
  auto_cashout_at: number | null
  cashout_multiplier: number | null
  winnings: number | null
  status: BetStatus
  settled_at: string | null
  created_at: string
}
```

- [ ] **Step 7: Create `packages/types/src/game.ts`**

```typescript
export type RoundStatus = 'waiting' | 'running' | 'crashed'

export interface GameRound {
  id: string
  round_number: number
  server_seed_hash: string  // committed before round
  server_seed: string | null  // revealed after round
  client_seed: string
  crash_point: number | null
  status: RoundStatus
  started_at: string | null
  crashed_at: string | null
  created_at: string
}
```

- [ ] **Step 8: Create `packages/types/src/tax.ts`**

```typescript
export type TaxType = 'wager_tax' | 'withdrawal_tax'
export type RemittanceStatus = 'pending_approval' | 'approved' | 'disputed'

export interface TaxRule {
  id: string
  country: string
  tax_type: TaxType
  rate: number   // percentage e.g. 12.50
  enabled: boolean
  updated_at: string
  updated_by: string | null
}

export interface TaxTransaction {
  id: string
  player_id: string
  transaction_id: string
  tax_type: TaxType
  country: string
  amount: number
  created_at: string
}

export interface TaxRemittance {
  id: string
  date: string       // YYYY-MM-DD
  country: string
  tax_type: TaxType
  total_amount: number
  transaction_count: number
  status: RemittanceStatus
  approved_by: string | null
  approved_at: string | null
  disputed_by: string | null
  disputed_at: string | null
  dispute_reason: string | null
  payment_reference: string | null
  created_at: string
}
```

- [ ] **Step 9: Create `packages/types/src/admin.ts`**

```typescript
export type AdminRole = 'super_admin' | 'finance' | 'support' | 'reports'
export type AdminStatus = 'active' | 'suspended'

export interface AdminUser {
  id: string
  name: string
  email: string
  role: AdminRole
  status: AdminStatus
  created_at: string
}

export interface AuditLogEntry {
  id: string
  admin_id: string
  action: string
  entity: string
  entity_id: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  created_at: string
}
```

- [ ] **Step 10: Create `packages/types/src/settings.ts`**

```typescript
export interface CountrySettings {
  country: string
  currency: string
  min_deposit: number
  max_deposit: number | null
  min_withdrawal: number
  max_withdrawal: number | null
  daily_withdrawal_limit: number | null
  remittance_cron: string
  tax_authority_bank_account: Record<string, string> | null
  remittance_enabled: boolean
  updated_at: string
}

export interface ProviderGame {
  id: string
  provider: string   // pragmatic_play | habanero | kiron | betgames
  game_id: string
  name: string
  game_type: 'slot' | 'virtual_sport'
  enabled: boolean
  metadata: Record<string, unknown> | null
}

export interface BonusConfig {
  welcome_bonus_rate: number    // e.g. 100 for 100% match
  welcome_bonus_cap: number     // max bonus in smallest currency unit
  wagering_multiplier: number   // e.g. 10 for 10x wagering requirement
}
```

- [ ] **Step 11: Create `packages/types/src/index.ts`**

```typescript
export * from './player.js'
export * from './wallet.js'
export * from './transaction.js'
export * from './bet.js'
export * from './game.js'
export * from './tax.js'
export * from './admin.js'
export * from './settings.js'
```

- [ ] **Step 12: Build types package**

```bash
cd packages/types && pnpm build
```

Expected: `dist/` folder created, no TypeScript errors.

- [ ] **Step 13: Commit**

```bash
git add packages/types
git commit -m "feat: add shared types package"
```

---

## Task 3: Create `packages/db` — client and migrations

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/migrate.ts`
- Create: `packages/db/src/index.ts`
- Create: `packages/db/migrations/001_players.sql` through `008_settings.sql`

- [ ] **Step 1: Create `packages/db/package.json`**

```json
{
  "name": "@betting/db",
  "version": "0.0.1",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "migrate": "node --loader ts-node/esm src/migrate.ts"
  },
  "dependencies": {
    "pg": "^8.11.5"
  },
  "devDependencies": {
    "@types/pg": "^8.11.6",
    "ts-node": "^10.9.2",
    "typescript": "^5.4.5"
  }
}
```

- [ ] **Step 2: Create `packages/db/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/db/src/client.ts`**

```typescript
import { Pool } from 'pg'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required')
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
})

pool.on('error', (err) => {
  console.error('Unexpected pg pool error', err)
})
```

- [ ] **Step 4: Create `packages/db/src/migrate.ts`**

```typescript
import fs from 'fs'
import path from 'path'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

async function migrate() {
  const client = await pool.connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    const migrationsDir = path.join(import.meta.dirname ?? __dirname, '..', 'migrations')
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()

    for (const file of files) {
      const { rows } = await client.query(
        'SELECT id FROM migrations WHERE filename = $1',
        [file]
      )
      if (rows.length > 0) {
        console.log(`  skip  ${file}`)
        continue
      }
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO migrations (filename) VALUES ($1)', [file])
      await client.query('COMMIT')
      console.log(`  apply ${file}`)
    }
    console.log('Migrations complete.')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

migrate().catch(err => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 5: Create `packages/db/src/index.ts`**

```typescript
export { pool } from './client.js'
```

- [ ] **Step 6: Create `packages/db/migrations/001_players.sql`**

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE players (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone        VARCHAR(20)  UNIQUE NOT NULL,
  name         VARCHAR(255) NOT NULL,
  country      CHAR(2)      NOT NULL,
  currency     CHAR(3)      NOT NULL,
  date_of_birth DATE        NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  status       VARCHAR(20)  NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','suspended','self_excluded')),
  self_excluded_until TIMESTAMPTZ,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_players_phone ON players(phone);
CREATE INDEX idx_players_country ON players(country);
```

- [ ] **Step 7: Create `packages/db/migrations/002_auth.sql`**

```sql
CREATE TABLE refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_player_id ON refresh_tokens(player_id);

CREATE TABLE otp_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone      VARCHAR(20)  NOT NULL,
  code_hash  VARCHAR(255) NOT NULL,
  purpose    VARCHAR(20)  NOT NULL CHECK (purpose IN ('registration','password_reset')),
  expires_at TIMESTAMPTZ  NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_otp_codes_phone ON otp_codes(phone);
```

- [ ] **Step 8: Create `packages/db/migrations/003_wallets.sql`**

```sql
CREATE TABLE wallets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id       UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  currency        CHAR(3) NOT NULL,
  balance         BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  bonus_balance   BIGINT NOT NULL DEFAULT 0 CHECK (bonus_balance >= 0),
  locked_balance  BIGINT NOT NULL DEFAULT 0 CHECK (locked_balance >= 0),
  UNIQUE(player_id, currency)
);

CREATE INDEX idx_wallets_player_id ON wallets(player_id);
```

- [ ] **Step 9: Create `packages/db/migrations/004_transactions.sql`**

```sql
CREATE TABLE transactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id        UUID NOT NULL REFERENCES wallets(id),
  player_id        UUID NOT NULL REFERENCES players(id),
  type             VARCHAR(30) NOT NULL
                   CHECK (type IN (
                     'deposit','withdrawal','bet_placed','bet_won','bet_refunded',
                     'bonus_credit','bonus_wager','wager_tax','withdrawal_tax'
                   )),
  amount           BIGINT NOT NULL,
  balance_after    BIGINT NOT NULL,
  status           VARCHAR(20) NOT NULL DEFAULT 'completed'
                   CHECK (status IN ('pending','completed','failed')),
  reference        VARCHAR(255),
  idempotency_key  VARCHAR(255) UNIQUE,
  metadata         JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_transactions_wallet_id ON transactions(wallet_id);
CREATE INDEX idx_transactions_player_id ON transactions(player_id);
CREATE INDEX idx_transactions_created_at ON transactions(created_at);
CREATE INDEX idx_transactions_idempotency_key ON transactions(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

- [ ] **Step 10: Create `packages/db/migrations/005_tax.sql`**

```sql
CREATE TABLE admin_users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(255) NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(20) NOT NULL
                CHECK (role IN ('super_admin','finance','support','reports')),
  status        VARCHAR(20) NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','suspended')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tax_rules (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country    CHAR(2)       NOT NULL,
  tax_type   VARCHAR(20)   NOT NULL CHECK (tax_type IN ('wager_tax','withdrawal_tax')),
  rate       NUMERIC(5,2)  NOT NULL CHECK (rate >= 0 AND rate <= 100),
  enabled    BOOLEAN       NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_by UUID          REFERENCES admin_users(id),
  UNIQUE(country, tax_type)
);

CREATE TABLE tax_transactions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id      UUID NOT NULL REFERENCES players(id),
  transaction_id UUID NOT NULL REFERENCES transactions(id),
  tax_type       VARCHAR(20) NOT NULL CHECK (tax_type IN ('wager_tax','withdrawal_tax')),
  country        CHAR(2)     NOT NULL,
  amount         BIGINT      NOT NULL CHECK (amount > 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tax_transactions_player_id ON tax_transactions(player_id);
CREATE INDEX idx_tax_transactions_created_at ON tax_transactions(created_at);
CREATE INDEX idx_tax_transactions_country ON tax_transactions(country);

CREATE TABLE ledger_closes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date       DATE    NOT NULL,
  country    CHAR(2) NOT NULL,
  closed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_by  VARCHAR(50) NOT NULL DEFAULT 'system',
  UNIQUE(date, country)
);

CREATE TABLE tax_remittances (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date              DATE        NOT NULL,
  country           CHAR(2)     NOT NULL,
  tax_type          VARCHAR(20) NOT NULL CHECK (tax_type IN ('wager_tax','withdrawal_tax')),
  total_amount      BIGINT      NOT NULL,
  transaction_count INTEGER     NOT NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'pending_approval'
                    CHECK (status IN ('pending_approval','approved','disputed')),
  approved_by       UUID        REFERENCES admin_users(id),
  approved_at       TIMESTAMPTZ,
  disputed_by       UUID        REFERENCES admin_users(id),
  disputed_at       TIMESTAMPTZ,
  dispute_reason    TEXT,
  payment_reference VARCHAR(255),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- [ ] **Step 11: Create `packages/db/migrations/006_games.sql`**

```sql
CREATE TABLE game_rounds (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_number     BIGSERIAL UNIQUE,
  server_seed_hash VARCHAR(255) NOT NULL,
  server_seed      VARCHAR(255),
  client_seed      VARCHAR(255) NOT NULL,
  crash_point      NUMERIC(10,2),
  status           VARCHAR(20) NOT NULL DEFAULT 'waiting'
                   CHECK (status IN ('waiting','running','crashed')),
  started_at       TIMESTAMPTZ,
  crashed_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_game_rounds_status ON game_rounds(status);

CREATE TABLE bets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id         UUID NOT NULL REFERENCES players(id),
  wallet_id         UUID NOT NULL REFERENCES wallets(id),
  round_id          UUID REFERENCES game_rounds(id),
  game_type         VARCHAR(20) NOT NULL
                    CHECK (game_type IN ('crash','slot','virtual_sport')),
  gross_stake       BIGINT       NOT NULL CHECK (gross_stake > 0),
  wager_tax         BIGINT       NOT NULL DEFAULT 0 CHECK (wager_tax >= 0),
  effective_stake   BIGINT       NOT NULL CHECK (effective_stake > 0),
  auto_cashout_at   NUMERIC(10,2),
  cashout_multiplier NUMERIC(10,2),
  winnings          BIGINT,
  status            VARCHAR(20)  NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','won','lost','refunded')),
  settled_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bets_player_id ON bets(player_id);
CREATE INDEX idx_bets_round_id ON bets(round_id) WHERE round_id IS NOT NULL;
CREATE INDEX idx_bets_status ON bets(status);

CREATE TABLE bonus_grants (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id            UUID   NOT NULL REFERENCES players(id),
  wallet_id            UUID   NOT NULL REFERENCES wallets(id),
  bonus_amount         BIGINT NOT NULL CHECK (bonus_amount > 0),
  wagering_requirement BIGINT NOT NULL CHECK (wagering_requirement > 0),
  wagered_so_far       BIGINT NOT NULL DEFAULT 0,
  status               VARCHAR(20) NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','completed','expired')),
  expires_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bonus_grants_player_id ON bonus_grants(player_id);
```

- [ ] **Step 12: Create `packages/db/migrations/007_admin.sql`**

```sql
CREATE TABLE admin_audit_log (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id  UUID NOT NULL REFERENCES admin_users(id),
  action    VARCHAR(100) NOT NULL,
  entity    VARCHAR(100) NOT NULL,
  entity_id VARCHAR(255),
  before    JSONB,
  after     JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_admin_audit_log_admin_id ON admin_audit_log(admin_id);
CREATE INDEX idx_admin_audit_log_entity ON admin_audit_log(entity, entity_id);
CREATE INDEX idx_admin_audit_log_created_at ON admin_audit_log(created_at);

CREATE TABLE admin_refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id   UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- [ ] **Step 13: Create `packages/db/migrations/008_settings.sql`**

```sql
CREATE TABLE country_settings (
  country                    CHAR(2) PRIMARY KEY,
  currency                   CHAR(3)  NOT NULL,
  min_deposit                BIGINT   NOT NULL DEFAULT 0,
  max_deposit                BIGINT,
  min_withdrawal             BIGINT   NOT NULL DEFAULT 0,
  max_withdrawal             BIGINT,
  daily_withdrawal_limit     BIGINT,
  remittance_cron            VARCHAR(100) NOT NULL DEFAULT '0 0 * * *',
  tax_authority_bank_account JSONB,
  remittance_enabled         BOOLEAN  NOT NULL DEFAULT false,
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO country_settings (country, currency) VALUES
  ('KE', 'KES'),
  ('UG', 'UGX'),
  ('TZ', 'TZS'),
  ('RW', 'RWF');

CREATE TABLE provider_games (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider  VARCHAR(50)  NOT NULL,
  game_id   VARCHAR(255) NOT NULL,
  name      VARCHAR(255) NOT NULL,
  game_type VARCHAR(20)  NOT NULL CHECK (game_type IN ('slot','virtual_sport')),
  enabled   BOOLEAN      NOT NULL DEFAULT true,
  metadata  JSONB,
  UNIQUE(provider, game_id)
);

INSERT INTO tax_rules (country, tax_type, rate, enabled) VALUES
  ('KE', 'wager_tax',      12.50, true),
  ('KE', 'withdrawal_tax', 20.00, true),
  ('UG', 'wager_tax',       0.00, false),
  ('UG', 'withdrawal_tax',  0.00, false),
  ('TZ', 'wager_tax',       0.00, false),
  ('TZ', 'withdrawal_tax',  0.00, false),
  ('RW', 'wager_tax',       0.00, false),
  ('RW', 'withdrawal_tax',  0.00, false);
```

- [ ] **Step 14: Commit**

```bash
git add packages/db
git commit -m "feat: add db package with migrations"
```

---

## Task 4: Docker Compose for local development

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example`

- [ ] **Step 1: Create `docker-compose.yml`**

```yaml
version: '3.9'

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: betting
      POSTGRES_PASSWORD: betting
      POSTGRES_DB: betting_dev
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redisdata:/data

volumes:
  pgdata:
  redisdata:
```

- [ ] **Step 2: Create `.env.example`**

```bash
# Database
DATABASE_URL=postgresql://betting:betting@localhost:5432/betting_dev

# Redis
REDIS_URL=redis://localhost:6379

# Auth — generate with: openssl rand -base64 64
JWT_SECRET=change_me_in_production
JWT_REFRESH_SECRET=change_me_in_production_too

# SMS (Africa's Talking)
AT_USERNAME=sandbox
AT_API_KEY=your_at_api_key

# App
NODE_ENV=development
PORT=3001
```

- [ ] **Step 3: Copy `.env.example` to `.env` and start services**

```bash
cp .env.example .env
docker compose up -d
```

Expected output: postgres and redis containers start with no errors.

- [ ] **Step 4: Run migrations**

```bash
pnpm migrate
```

Expected:
```
  apply 001_players.sql
  apply 002_auth.sql
  apply 003_wallets.sql
  apply 004_transactions.sql
  apply 005_tax.sql
  apply 006_games.sql
  apply 007_admin.sql
  apply 008_settings.sql
Migrations complete.
```

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml .env.example
git commit -m "chore: add docker-compose for local dev"
```

---

## Task 5: Create `apps/api` — Fastify skeleton with health check

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/env.ts`
- Create: `apps/api/src/server.ts`
- Create: `apps/api/src/index.ts`
- Create: `apps/api/src/routes/health.ts`
- Test: `apps/api/src/routes/health.test.ts`

- [ ] **Step 1: Create `apps/api/package.json`**

```json
{
  "name": "api",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@betting/db": "workspace:*",
    "@betting/types": "workspace:*",
    "@fastify/cookie": "^9.3.1",
    "@fastify/cors": "^9.0.1",
    "@fastify/jwt": "^8.0.1",
    "fastify": "^4.27.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "tsx": "^4.15.7",
    "typescript": "^5.4.5",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create `apps/api/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "NodeNext",
    "moduleResolution": "NodeNext"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `apps/api/src/env.ts`**

```typescript
import { z } from 'zod'

const schema = z.object({
  NODE_ENV:            z.enum(['development', 'test', 'production']).default('development'),
  PORT:                z.coerce.number().default(3001),
  DATABASE_URL:        z.string().min(1),
  REDIS_URL:           z.string().min(1),
  JWT_SECRET:          z.string().min(32),
  JWT_REFRESH_SECRET:  z.string().min(32),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid environment variables:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
```

- [ ] **Step 4: Write the failing test first**

Create `apps/api/src/routes/health.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildServer } from '../server.js'

describe('GET /health', () => {
  const app = buildServer()

  afterAll(() => app.close())

  it('returns 200 with status ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
  })
})
```

- [ ] **Step 5: Run the test — verify it fails**

```bash
cd apps/api && pnpm test
```

Expected: FAIL — `buildServer is not defined` or similar.

- [ ] **Step 6: Create `apps/api/src/routes/health.ts`**

```typescript
import type { FastifyInstance } from 'fastify'

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => {
    return { status: 'ok' }
  })
}
```

- [ ] **Step 7: Create `apps/api/src/server.ts`**

```typescript
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import { healthRoutes } from './routes/health.js'

export function buildServer() {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' })

  app.register(cors, { origin: true })
  app.register(cookie)
  app.register(healthRoutes)

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

- [ ] **Step 8: Create `apps/api/src/index.ts`**

```typescript
import { buildServer } from './server.js'
import { env } from './env.js'

const app = buildServer()

app.listen({ port: env.PORT, host: '0.0.0.0' }, (err) => {
  if (err) {
    app.log.error(err)
    process.exit(1)
  }
  app.log.info(`API server listening on port ${env.PORT}`)
})
```

- [ ] **Step 9: Run the test — verify it passes**

```bash
cd apps/api && pnpm test
```

Expected:
```
✓ GET /health > returns 200 with status ok
Test Files  1 passed (1)
```

- [ ] **Step 10: Start the dev server and manually verify**

```bash
pnpm dev:api
```

In another terminal:
```bash
curl http://localhost:3001/health
```

Expected: `{"status":"ok"}`

- [ ] **Step 11: Commit**

```bash
git add apps/api
git commit -m "feat: add api app with health check endpoint"
```

---

## Task 6: Create `apps/web` — Next.js skeleton

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/next.config.mjs`
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/page.tsx`

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
    "next": "^14.2.3",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "typescript": "^5.4.5"
  }
}
```

- [ ] **Step 2: Create `apps/web/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "module": "esnext",
    "moduleResolution": "bundler",
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
  transpilePackages: ['@betting/types'],
}

export default nextConfig
```

- [ ] **Step 4: Create `apps/web/src/app/layout.tsx`**

```tsx
export const metadata = { title: 'Betting Platform' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
```

- [ ] **Step 5: Create `apps/web/src/app/page.tsx`**

```tsx
export default function HomePage() {
  return <main><h1>Betting Platform</h1></main>
}
```

- [ ] **Step 6: Verify it builds**

```bash
cd apps/web && pnpm build
```

Expected: Build completes with no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat: add web app skeleton"
```

---

## Task 7: Create `apps/admin` — Next.js skeleton

**Files:**
- Create: `apps/admin/package.json`
- Create: `apps/admin/tsconfig.json`
- Create: `apps/admin/next.config.mjs`
- Create: `apps/admin/src/app/layout.tsx`
- Create: `apps/admin/src/app/page.tsx`

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
    "next": "^14.2.3",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "typescript": "^5.4.5"
  }
}
```

- [ ] **Step 2: Create `apps/admin/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `apps/admin/next.config.mjs`**

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@betting/types'],
}

export default nextConfig
```

- [ ] **Step 4: Create `apps/admin/src/app/layout.tsx`**

```tsx
export const metadata = { title: 'Betting Admin' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
```

- [ ] **Step 5: Create `apps/admin/src/app/page.tsx`**

```tsx
export default function AdminHomePage() {
  return <main><h1>Betting Admin</h1></main>
}
```

- [ ] **Step 6: Verify it builds**

```bash
cd apps/admin && pnpm build
```

Expected: Build completes with no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/admin
git commit -m "feat: add admin app skeleton"
```

---

## Task 8: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:16-alpine
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

      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    env:
      DATABASE_URL: postgresql://betting:betting@localhost:5432/betting_test
      REDIS_URL: redis://localhost:6379
      JWT_SECRET: ci_jwt_secret_at_least_32_characters_long
      JWT_REFRESH_SECRET: ci_refresh_secret_at_least_32_chars_long
      NODE_ENV: test

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v3
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - run: pnpm install

      - name: Run migrations
        run: pnpm migrate

      - name: Run tests
        run: pnpm test

      - name: Build all apps
        run: pnpm build
```

- [ ] **Step 2: Push to GitHub and verify CI passes**

```bash
git add .github
git commit -m "ci: add GitHub Actions workflow"
git push origin main
```

Go to the repository's Actions tab and confirm the workflow passes.

---

## Self-Review Checklist

- [x] Monorepo root with pnpm workspaces — Task 1
- [x] Shared types for all domain entities — Task 2
- [x] Complete DB schema (8 migrations covering all tables from spec) — Task 3
- [x] Docker Compose with Postgres + Redis — Task 4
- [x] Fastify API with health check, error handler, env validation — Task 5
- [x] Next.js web app skeleton — Task 6
- [x] Next.js admin app skeleton — Task 7
- [x] CI pipeline — Task 8
- [x] Default tax rules seeded for KE/UG/TZ/RW — migration 008
- [x] Default country_settings rows seeded for all four countries — migration 008

---

## What Comes Next

| Plan | Covers |
|---|---|
| **Phase 2** | Auth & Player Accounts — registration, OTP, login, JWT, refresh tokens, self-exclusion |
| **Phase 3** | Wallet, Tax Engine & Payment Providers — full money flow with M-Pesa/MTN/Airtel |
| **Phase 4** | Crash Game Engine — provably fair RNG, WebSocket, round lifecycle, bet settlement |
| **Phase 5** | Third-Party Game Integrations — seamless wallet API, slots + virtual sports |
| **Phase 6** | Tax Reconciliation & Admin Back-Office — daily cron, remittance workflow, reports |
