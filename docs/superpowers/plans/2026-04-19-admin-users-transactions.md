# Admin Users & Transactions Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Users and Transactions tabs to the admin dashboard with three new API routes and two new React components.

**Architecture:** Three new API route files in `apps/api/src/routes/admin/`, two new React component files in `apps/admin/src/components/`, and minimal edits to `server.ts` and `dashboard/page.tsx` to wire them in. Tests use vitest with mocked DB pool and mocked `authenticateAdmin` middleware — same pattern as `auth.test.ts`.

**Tech Stack:** Fastify, PostgreSQL (`@betting/db` pool), bcryptjs, vitest, Next.js 14, React hooks, Tailwind CSS

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `apps/api/src/routes/admin/players.ts` | GET /admin/players, POST /admin/players/:id/reset-password |
| Create | `apps/api/src/routes/admin/players.test.ts` | Tests for both player routes |
| Create | `apps/api/src/routes/admin/transactions.ts` | GET /admin/transactions |
| Create | `apps/api/src/routes/admin/transactions.test.ts` | Tests for transactions route |
| Modify | `apps/api/src/server.ts` | Register new routes |
| Create | `apps/admin/src/components/UsersTab.tsx` | Users table + reset password modal |
| Create | `apps/admin/src/components/TransactionsTab.tsx` | Transactions table + type filter |
| Modify | `apps/admin/src/app/dashboard/page.tsx` | Extend tab type, render new components |

---

### Task 1: Players API routes

**Files:**
- Create: `apps/api/src/routes/admin/players.ts`
- Create: `apps/api/src/routes/admin/players.test.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/routes/admin/players.test.ts`:

```ts
import { describe, it, expect, vi, afterAll } from 'vitest'

vi.mock('../../middleware/authenticateAdmin.js', () => ({
  authenticateAdmin: vi.fn(async (req: { adminId: string; adminRole: string }, _reply: unknown) => {
    req.adminId = 'admin-1'
    req.adminRole = 'super'
  }),
}))

vi.mock('@betting/db', () => ({
  pool: { query: vi.fn() },
}))

vi.mock('../../lib/hash.js', () => ({
  hashPassword: vi.fn(async (plain: string) => `hashed_${plain}`),
}))

import { buildServer } from '../../server.js'
import { pool } from '@betting/db'

const mockQuery = vi.mocked(pool.query)

describe('GET /admin/players', () => {
  const app = buildServer()
  afterAll(() => app.close())

  it('returns player list', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'uuid-1',
          name: 'Alice',
          phone: '+254700000001',
          country: 'KE',
          balance: 150000,
          created_at: '2026-04-01T10:00:00Z',
        },
      ],
    } as never)

    const res = await app.inject({
      method: 'GET',
      url: '/admin/players',
      headers: { Authorization: 'Bearer fake-admin-token' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.players).toHaveLength(1)
    expect(body.players[0].id).toBe('uuid-1')
    expect(body.players[0].phone).toBe('+254700000001')
  })
})

describe('POST /admin/players/:id/reset-password', () => {
  const app = buildServer()
  afterAll(() => app.close())

  it('returns tempPassword when player exists', async () => {
    // First query: SELECT player (exists)
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'uuid-1', phone: '+254700000001', name: 'Alice' }],
    } as never)
    // Second query: UPDATE password_hash
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)

    const res = await app.inject({
      method: 'POST',
      url: '/admin/players/uuid-1/reset-password',
      headers: { Authorization: 'Bearer fake-admin-token' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.tempPassword).toBeDefined()
    expect(typeof body.tempPassword).toBe('string')
    expect(body.tempPassword.length).toBe(8)
  })

  it('returns 404 when player not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)

    const res = await app.inject({
      method: 'POST',
      url: '/admin/players/nonexistent-id/reset-password',
      headers: { Authorization: 'Bearer fake-admin-token' },
    })

    expect(res.statusCode).toBe(404)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && pnpm vitest run src/routes/admin/players.test.ts
```

Expected: FAIL — `players.ts` does not exist yet.

- [ ] **Step 3: Create `apps/api/src/routes/admin/players.ts`**

```ts
import { randomBytes } from 'crypto'
import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'
import { authenticateAdmin } from '../../middleware/authenticateAdmin.js'
import { hashPassword } from '../../lib/hash.js'

function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = randomBytes(8)
  return Array.from(bytes).map(b => chars[b % chars.length]).join('')
}

export async function adminPlayersRoutes(app: FastifyInstance) {
  app.get('/admin/players', { preHandler: authenticateAdmin }, async (_req, reply) => {
    const { rows } = await pool.query<{
      id: string; name: string; phone: string; country: string
      balance: string; created_at: string
    }>(
      `SELECT p.id, p.name, p.phone, p.country, p.created_at,
              COALESCE(w.balance, 0) AS balance
       FROM players p
       LEFT JOIN wallets w ON w.player_id = p.id
       ORDER BY p.created_at DESC`,
    )

    return reply.send({
      players: rows.map(r => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        country: r.country,
        balance: Number(r.balance),
        createdAt: r.created_at,
      })),
    })
  })

  app.post('/admin/players/:id/reset-password', { preHandler: authenticateAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string }

    const { rows } = await pool.query<{ id: string; phone: string; name: string }>(
      `SELECT id, phone, name FROM players WHERE id = $1`,
      [id],
    )
    if (rows.length === 0) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Player not found' } })
    }

    const tempPassword = generateTempPassword()
    const passwordHash = await hashPassword(tempPassword)

    await pool.query(
      `UPDATE players SET password_hash = $1 WHERE id = $2`,
      [passwordHash, id],
    )

    console.log(
      `[SMS STUB] To: ${rows[0].phone} | Msg: Your WinguBet temporary password is ${tempPassword}. Please change it after logging in.`,
    )

    return reply.send({ tempPassword })
  })
}
```

- [ ] **Step 4: Register the route in `apps/api/src/server.ts`**

Add this import near the other admin imports (after the `adminBannerRoutes` import):

```ts
import { adminPlayersRoutes } from './routes/admin/players.js'
```

Add this registration after `app.register(adminBannerRoutes)`:

```ts
app.register(adminPlayersRoutes)
```

- [ ] **Step 5: Run tests — verify they pass**

```bash
cd apps/api && pnpm vitest run src/routes/admin/players.test.ts
```

Expected: PASS — 3 tests passing.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/admin/players.ts apps/api/src/routes/admin/players.test.ts apps/api/src/server.ts
git commit -m "feat(admin): add GET /admin/players and POST /admin/players/:id/reset-password"
```

---

### Task 2: Transactions API route

**Files:**
- Create: `apps/api/src/routes/admin/transactions.ts`
- Create: `apps/api/src/routes/admin/transactions.test.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/routes/admin/transactions.test.ts`:

```ts
import { describe, it, expect, vi, afterAll } from 'vitest'

vi.mock('../../middleware/authenticateAdmin.js', () => ({
  authenticateAdmin: vi.fn(async (req: { adminId: string; adminRole: string }, _reply: unknown) => {
    req.adminId = 'admin-1'
    req.adminRole = 'super'
  }),
}))

vi.mock('@betting/db', () => ({
  pool: { query: vi.fn() },
}))

import { buildServer } from '../../server.js'
import { pool } from '@betting/db'

const mockQuery = vi.mocked(pool.query)

describe('GET /admin/transactions', () => {
  const app = buildServer()
  afterAll(() => app.close())

  it('returns transaction list', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'tx-1',
          type: 'bet_placed',
          amount: '10000',
          balance_after: '990000',
          created_at: '2026-04-19T14:00:00Z',
          player_name: 'Alice',
        },
      ],
    } as never)

    const res = await app.inject({
      method: 'GET',
      url: '/admin/transactions',
      headers: { Authorization: 'Bearer fake-admin-token' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.transactions).toHaveLength(1)
    expect(body.transactions[0].type).toBe('bet_placed')
    expect(body.transactions[0].amount).toBe(10000)
    expect(body.transactions[0].playerName).toBe('Alice')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && pnpm vitest run src/routes/admin/transactions.test.ts
```

Expected: FAIL — `transactions.ts` does not exist yet.

- [ ] **Step 3: Create `apps/api/src/routes/admin/transactions.ts`**

```ts
import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'
import { authenticateAdmin } from '../../middleware/authenticateAdmin.js'

export async function adminTransactionsRoutes(app: FastifyInstance) {
  app.get('/admin/transactions', { preHandler: authenticateAdmin }, async (_req, reply) => {
    const { rows } = await pool.query<{
      id: string; type: string; amount: string; balance_after: string
      created_at: string; player_name: string
    }>(
      `SELECT t.id, t.type, t.amount, t.balance_after, t.created_at,
              p.name AS player_name
       FROM transactions t
       JOIN players p ON p.id = t.player_id
       WHERE t.type != 'demo_topup'
       ORDER BY t.created_at DESC
       LIMIT 200`,
    )

    return reply.send({
      transactions: rows.map(r => ({
        id: r.id,
        playerName: r.player_name,
        type: r.type,
        amount: Number(r.amount),
        balanceAfter: Number(r.balance_after),
        createdAt: r.created_at,
      })),
    })
  })
}
```

- [ ] **Step 4: Register the route in `apps/api/src/server.ts`**

Add this import after the `adminPlayersRoutes` import:

```ts
import { adminTransactionsRoutes } from './routes/admin/transactions.js'
```

Add this registration after `app.register(adminPlayersRoutes)`:

```ts
app.register(adminTransactionsRoutes)
```

- [ ] **Step 5: Run test — verify it passes**

```bash
cd apps/api && pnpm vitest run src/routes/admin/transactions.test.ts
```

Expected: PASS — 1 test passing.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/admin/transactions.ts apps/api/src/routes/admin/transactions.test.ts apps/api/src/server.ts
git commit -m "feat(admin): add GET /admin/transactions"
```

---

### Task 3: UsersTab component

**Files:**
- Create: `apps/admin/src/components/UsersTab.tsx`

- [ ] **Step 1: Create `apps/admin/src/components/UsersTab.tsx`**

```tsx
'use client'
import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api'

interface Player {
  id: string
  name: string
  phone: string
  country: string
  balance: number
  createdAt: string
}

function maskPhone(phone: string): string {
  if (phone.length < 8) return phone
  const prefix = phone.slice(0, 5)
  const suffix = phone.slice(-3)
  return `${prefix}** *** ${suffix}`
}

function kes(cents: number) {
  return `KES ${(cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`
}

export function UsersTab() {
  const [players, setPlayers] = useState<Player[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resetting, setResetting] = useState<string | null>(null)
  const [modal, setModal] = useState<{ playerName: string; phone: string; tempPassword: string } | null>(null)
  const [resetError, setResetError] = useState<{ playerId: string; message: string } | null>(null)

  const fetchPlayers = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: apiError } = await apiFetch<{ players: Player[] }>('/admin/players')
    if (data) {
      setPlayers(data.players)
    } else {
      setError(apiError?.message ?? 'Failed to load players')
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchPlayers() }, [fetchPlayers])

  async function handleResetPassword(player: Player) {
    setResetting(player.id)
    setModalError(null)
    const { data, error: apiError } = await apiFetch<{ tempPassword: string }>(
      `/admin/players/${player.id}/reset-password`,
      { method: 'POST' },
    )
    setResetting(null)
    if (data) {
      setResetError(null)
      setModal({ playerName: player.name, phone: player.phone, tempPassword: data.tempPassword })
    } else {
      setResetError({ playerId: player.id, message: apiError?.message ?? 'Reset failed' })
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-500">Loading players…</div>
  }

  if (error) {
    return <div className="flex items-center justify-center h-64 text-red-400">{error}</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Players</h2>
        <span className="text-xs text-gray-500">{players.length} total</span>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 uppercase border-b border-gray-800">
                <th className="text-left px-5 py-3">Customer ID</th>
                <th className="text-left px-5 py-3">Name</th>
                <th className="text-left px-5 py-3">Phone</th>
                <th className="text-left px-5 py-3">Country</th>
                <th className="text-right px-5 py-3">Balance</th>
                <th className="text-left px-5 py-3">Joined</th>
                <th className="text-left px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {players.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-gray-600">No players yet</td>
                </tr>
              )}
              {players.map(p => (
                <tr key={p.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                  <td className="px-5 py-3 font-mono text-xs text-gray-400">{p.id.slice(0, 8)}</td>
                  <td className="px-5 py-3 font-medium">{p.name}</td>
                  <td className="px-5 py-3 font-mono text-gray-400">{maskPhone(p.phone)}</td>
                  <td className="px-5 py-3 text-gray-400">{p.country}</td>
                  <td className="px-5 py-3 text-right font-mono text-gray-300">{kes(p.balance)}</td>
                  <td className="px-5 py-3 text-gray-500 text-xs">
                    {new Date(p.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-3">
                    <button
                      onClick={() => handleResetPassword(p)}
                      disabled={resetting === p.id}
                      className="text-xs text-yellow-400 hover:text-yellow-300 disabled:opacity-50 transition-colors"
                    >
                      {resetting === p.id ? '…' : 'Reset Password'}
                    </button>
                    {resetError?.playerId === p.id && (
                      <p className="text-xs text-red-400 mt-1">{resetError.message}</p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reset password modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-sm space-y-4">
            <h3 className="font-semibold text-white">Password Reset</h3>
            <div className="space-y-1">
              <p className="text-sm text-gray-400">
                <span className="text-white font-medium">{modal.playerName}</span>
                {' · '}
                <span className="font-mono">{maskPhone(modal.phone)}</span>
              </p>
              <p className="text-xs text-gray-500">Temporary password:</p>
              <p className="font-mono text-lg tracking-widest text-cyan-400 bg-gray-800 rounded-lg px-4 py-2 text-center select-all">
                {modal.tempPassword}
              </p>
            </div>
            <p className="text-xs text-green-400">SMS sent (simulated)</p>
            <button
              onClick={() => setModal(null)}
              className="w-full bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium py-2 rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/admin && pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/components/UsersTab.tsx
git commit -m "feat(admin): add UsersTab component with phone masking and password reset modal"
```

---

### Task 4: TransactionsTab component

**Files:**
- Create: `apps/admin/src/components/TransactionsTab.tsx`

- [ ] **Step 1: Create `apps/admin/src/components/TransactionsTab.tsx`**

```tsx
'use client'
import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api'

interface Transaction {
  id: string
  playerName: string
  type: string
  amount: number
  balanceAfter: number
  createdAt: string
}

type Filter = 'all' | 'deposits' | 'bets' | 'withdrawals'

const TYPE_BADGE: Record<string, string> = {
  deposit: 'bg-green-900/50 text-green-400 border border-green-700/50',
  bet_won: 'bg-green-900/50 text-green-400 border border-green-700/50',
  bet_placed: 'bg-red-900/50 text-red-400 border border-red-700/50',
  withdrawal: 'bg-red-900/50 text-red-400 border border-red-700/50',
}

const TYPE_LABEL: Record<string, string> = {
  deposit: 'Deposit',
  bet_won: 'Bet Won',
  bet_placed: 'Bet Placed',
  withdrawal: 'Withdrawal',
}

function kes(cents: number) {
  return `KES ${(cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`
}

function matchesFilter(type: string, filter: Filter): boolean {
  if (filter === 'all') return true
  if (filter === 'deposits') return type === 'deposit'
  if (filter === 'bets') return type === 'bet_placed' || type === 'bet_won'
  if (filter === 'withdrawals') return type === 'withdrawal'
  return true
}

export function TransactionsTab() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')

  const fetchTransactions = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: apiError } = await apiFetch<{ transactions: Transaction[] }>('/admin/transactions')
    if (data) {
      setTransactions(data.transactions)
    } else {
      setError(apiError?.message ?? 'Failed to load transactions')
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchTransactions() }, [fetchTransactions])

  const filtered = transactions.filter(t => matchesFilter(t.type, filter))

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-500">Loading transactions…</div>
  }

  if (error) {
    return <div className="flex items-center justify-center h-64 text-red-400">{error}</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Transactions</h2>
        <div className="flex items-center gap-3">
          <select
            value={filter}
            onChange={e => setFilter(e.target.value as Filter)}
            className="bg-gray-800 border border-gray-700 text-sm text-white rounded-lg px-3 py-1.5 focus:outline-none focus:border-cyan-600"
          >
            <option value="all">All Types</option>
            <option value="deposits">Deposits</option>
            <option value="bets">Bets</option>
            <option value="withdrawals">Withdrawals</option>
          </select>
          <span className="text-xs text-gray-500">{filtered.length} shown</span>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 uppercase border-b border-gray-800">
                <th className="text-left px-5 py-3">Player</th>
                <th className="text-left px-5 py-3">Type</th>
                <th className="text-right px-5 py-3">Amount</th>
                <th className="text-right px-5 py-3">Balance After</th>
                <th className="text-left px-5 py-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-gray-600">No transactions</td>
                </tr>
              )}
              {filtered.map(t => (
                <tr key={t.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                  <td className="px-5 py-3 font-medium">{t.playerName}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${TYPE_BADGE[t.type] ?? 'bg-gray-800 text-gray-400'}`}>
                      {TYPE_LABEL[t.type] ?? t.type}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-gray-300">{kes(t.amount)}</td>
                  <td className="px-5 py-3 text-right font-mono text-gray-400">{kes(t.balanceAfter)}</td>
                  <td className="px-5 py-3 text-gray-500 text-xs">
                    {new Date(t.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/admin && pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/components/TransactionsTab.tsx
git commit -m "feat(admin): add TransactionsTab component with type filter"
```

---

### Task 5: Wire tabs into dashboard + deploy

**Files:**
- Modify: `apps/admin/src/app/dashboard/page.tsx`

- [ ] **Step 1: Add imports at the top of `dashboard/page.tsx`**

After the existing imports (after `import { apiFetch } from '@/lib/api'`), add:

```ts
import { UsersTab } from '@/components/UsersTab'
import { TransactionsTab } from '@/components/TransactionsTab'
```

- [ ] **Step 2: Extend the tab type on line 397**

Change:
```ts
const [tab, setTab] = useState<'stats' | 'promotions'>('stats')
```

To:
```ts
const [tab, setTab] = useState<'stats' | 'promotions' | 'users' | 'transactions'>('stats')
```

- [ ] **Step 3: Extend the tab bar on line 508**

Change:
```tsx
{(['stats', 'promotions'] as const).map(t => (
```

To:
```tsx
{(['stats', 'promotions', 'users', 'transactions'] as const).map(t => (
```

- [ ] **Step 4: Add tab render blocks before the closing `</main>` tag (after the promotions block ending at line 632)**

After the closing `)}` of the promotions block (around line 632), add:

```tsx
      {/* Users tab */}
      {tab === 'users' && <UsersTab />}

      {/* Transactions tab */}
      {tab === 'transactions' && <TransactionsTab />}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd apps/admin && pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/app/dashboard/page.tsx
git commit -m "feat(admin): wire Users and Transactions tabs into dashboard"
```

- [ ] **Step 7: Push and deploy API + Admin**

```bash
git push origin master
```

Trigger API deploy (new routes):
```bash
curl -s -w "\n%{http_code}" -X POST "https://api.render.com/v1/services/srv-d7eb279o3t8c73ebvvdg/deploys" \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"clearCache":"do_not_clear"}'
```

Trigger Admin deploy (new tabs):
```bash
curl -s -w "\n%{http_code}" -X POST "https://api.render.com/v1/services/srv-d7ee004vikkc73enkl40/deploys" \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"clearCache":"do_not_clear"}'
```

Expected: both return `202`.
