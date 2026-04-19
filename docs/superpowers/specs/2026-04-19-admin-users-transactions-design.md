# Admin Users & Transactions Tabs Design

## Goal

Add two new tabs to the admin dashboard: **Users** (player list with password reset) and **Transactions** (full transaction ledger).

## Architecture

Two new React component files alongside the existing dashboard page. Tab switcher in `dashboard/page.tsx` extends from `'stats' | 'promotions'` to `'stats' | 'promotions' | 'users' | 'transactions'`. Three new API routes added to the admin router.

**Tech Stack:** Next.js 14 (App Router), React hooks, Tailwind CSS, Fastify, PostgreSQL via `@betting/db`

---

## Frontend

### New files

- `apps/admin/src/components/UsersTab.tsx`
- `apps/admin/src/components/TransactionsTab.tsx`

### Modified files

- `apps/admin/src/app/dashboard/page.tsx` — extend tab type, import and render new tab components

### UsersTab

**Columns:** Customer ID | Name | Phone | Country | Balance | Joined | Action

- **Customer ID:** first 8 chars of player UUID (e.g. `a1b2c3d4`)
- **Phone:** masked in UI — `+254 7** *** 456` (show first 5 and last 3 digits, mask middle 4). Full phone never rendered.
- **Balance:** displayed as `KES X,XXX.XX` (divide cents by 100)
- **Joined:** formatted date string
- **Action:** "Reset Password" button per row

**Reset Password flow:**
1. Admin clicks "Reset Password" on a row
2. `POST /admin/players/:id/reset-password` is called
3. On success, a modal appears showing:
   - Player name and masked phone
   - The temporary password in a monospace box
   - Note: "SMS sent (simulated)"
4. Modal has a "Close" button

**Loading/error states:** spinner while fetching, error message if fetch fails.

### TransactionsTab

**Columns:** Player | Type | Amount | Balance After | Date

- **Type badge colors:**
  - `deposit` → green
  - `bet_won` → green
  - `bet_placed` → red
  - `withdrawal` → red
- **Amount & Balance After:** `KES X,XXX.XX` (divide cents by 100)
- **Date:** formatted datetime string

**Filter:** dropdown above table — "All Types" / "Deposits" / "Bets" / "Withdrawals"
- "Bets" filter shows both `bet_placed` and `bet_won`
- Filter is client-side on the already-fetched 200 rows

**Loading/error states:** spinner while fetching, error message if fetch fails.

---

## Backend

### New files

- `apps/api/src/routes/admin/players.ts`
- `apps/api/src/routes/admin/transactions.ts`

### Modified files

- `apps/api/src/server.ts` — register new routes

### GET /admin/players

Protected by `authenticateAdmin`.

Query: `SELECT id, name, phone, country, created_at FROM players ORDER BY created_at DESC`

Join with wallets: `LEFT JOIN wallets ON wallets.player_id = players.id` to get `balance`.

Response shape:
```json
[
  {
    "id": "uuid",
    "name": "John Doe",
    "phone": "+254700000000",
    "country": "KE",
    "balance": 150000,
    "createdAt": "2026-04-01T10:00:00Z"
  }
]
```

Note: phone is returned in full — masking happens on the frontend only.

### POST /admin/players/:id/reset-password

Protected by `authenticateAdmin`.

1. Generate 8-character alphanumeric temp password (uppercase + digits, e.g. `A3B7X9K2`)
2. Hash with bcrypt (same as existing auth service)
3. `UPDATE players SET password_hash = $1 WHERE id = $2`
4. Simulate SMS: `console.log(`[SMS STUB] To: ${player.phone} | Msg: Your WinguBet temp password is ${tempPassword}`)` 
5. Return `{ tempPassword }`

Zod validation: `:id` must be a valid UUID.

Error: 404 if player not found.

### GET /admin/transactions

Protected by `authenticateAdmin`.

Query:
```sql
SELECT t.id, t.type, t.amount, t.balance_after, t.created_at,
       p.name AS player_name
FROM transactions t
JOIN players p ON p.id = t.player_id
WHERE t.type != 'demo_topup'
ORDER BY t.created_at DESC
LIMIT 200
```

Response shape:
```json
[
  {
    "id": "uuid",
    "playerName": "John Doe",
    "type": "bet_placed",
    "amount": 10000,
    "balanceAfter": 990000,
    "createdAt": "2026-04-19T14:00:00Z"
  }
]
```

---

## Phone Masking Logic (frontend utility)

```ts
function maskPhone(phone: string): string {
  // +254700123456 → +254 7** *** 456
  if (phone.length < 8) return phone
  const prefix = phone.slice(0, 5)   // +2547
  const suffix = phone.slice(-3)      // 456
  return `${prefix}** *** ${suffix}`
}
```

---

## Error Handling

- All API errors return `{ error: { code, message } }` — frontend displays `error.message` in red text below table
- Reset password: if API returns error, show error message in modal instead of temp password
- Network failures: caught by apiFetch wrapper, surfaced as error state

---

## Out of Scope

- Pagination (50 users, 200 transactions is sufficient for now)
- Suspend/ban players
- Date range filters on transactions
- Real SMS delivery (simulated only)
- Search/filter on Users tab
