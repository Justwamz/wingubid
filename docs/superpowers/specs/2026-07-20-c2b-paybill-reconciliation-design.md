# C2B paybill deposits + reconciliation - Design

**Date:** 2026-07-20
**Status:** Approved

## Goal

STK push stays the primary top-up method. Add a **paybill (C2B) fallback**: when a
customer pays the deposit paybill directly, match the paying M-Pesa number to a
registered user and credit their wallet. If the number isn't a user, hold the
payment in an itemized suspense record for manual admin reconciliation (repost to
a user, or refund). Every paybill payment is recorded (matched and unmatched).

Real Safaricom Daraja registration/credentials and a future self-service
"paste your M-Pesa message" chatbot are out of scope; the schema stores the
receipt code so the chatbot is easy to add later.

## Data

New table `c2b_payments`:
- `id` UUID PK
- `msisdn` VARCHAR(20) - payer phone, normalized to +2547...
- `amount` BIGINT - cents
- `mpesa_receipt` VARCHAR(64) UNIQUE - idempotency (a re-sent webhook never double-credits)
- `status` VARCHAR(20) - `credited` | `unresolved` | `reposted` | `refunded`
- `player_id` UUID NULL REFERENCES players(id) - matched or admin-assigned user
- `resolved_by` UUID NULL - admin_users id (audit)
- `resolved_at` TIMESTAMPTZ NULL
- `note` TEXT NULL
- `created_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
- indexes on `status`, `created_at`

## Intake logic - `c2b.service.ts`

`recordC2bPayment({ msisdn, amount, mpesaReceipt })` (one transaction):
1. Idempotency: if `mpesa_receipt` already exists, no-op (return existing status).
2. Normalize msisdn -> look up `players.phone`.
3. **Match** -> `creditDeposit` (wallet balance + ledger, idempotency key `c2b:<receipt>`) and insert row `status='credited'`, `player_id`.
4. **No match** -> insert row `status='unresolved'` (held; no credit).

Admin reconciliation:
- `repostC2bPayment(id, phone, adminId)`: only if `unresolved`. Resolve phone -> player (friendly error if not found), credit that wallet, set `status='reposted'`, `player_id`, `resolved_by/at`.
- `refundC2bPayment(id, adminId, note?)`: only if `unresolved`. Set `status='refunded'`, `resolved_by/at`, note. (Actual money refund is manual/B2C later; this records the decision + audit.)
- `listC2bPayments()`: last 100 rows (+ payer/assigned phone) and totals by status:
  - **uncredited** = sum(unresolved), **refunded** = sum(refunded), **credited** = sum(credited + reposted).

## API routes

- **Real (later Daraja):** `POST /webhooks/mpesa/c2b` - secret-gated (`authenticatePaymentWebhook`), parses Safaricom C2B confirmation (`TransID`, `TransAmount`, `MSISDN`) -> `recordC2bPayment`. Documented as needing Daraja URL registration to go live.
- **Testing (now):** `POST /wallet/demo-c2b` - gated on `DEMO_MODE` (works in the current demo prod), body `{ msisdn, amount, mpesaReceipt? }` -> `recordC2bPayment`. Lets us exercise match/suspense/reconcile end-to-end without Safaricom.
- **Admin (rights-gated):**
  - `GET /admin/c2b-payments` -> `{ payments, totals }`
  - `POST /admin/c2b-payments/:id/repost` `{ phone }`
  - `POST /admin/c2b-payments/:id/refund` `{ note? }`

## Admin config

Split the single M-Pesa `shortCode` into two labelled fields: **Deposit Paybill
(C2B)** and **Withdrawal Shortcode (B2C)**. Stored in the `payment_configs` JSONB;
not read at runtime yet (wired when Daraja goes live).

## Admin UI - new "Reconciliation" tab

- **Summary cards** across the top: **Uncredited**, **Refunded**, **Credited** (+reposted).
- **Table**: date, payer number, amount, M-Pesa receipt, status, assigned user.
- **Actions** on `unresolved` rows: **Repost** (enter a user's phone -> credit) and **Refund** - both audited. Resolved rows show status + who/when.

## Testing

`tsc` clean (api + admin); unit test for `recordC2bPayment` (match credits, no-match holds, duplicate receipt is idempotent). End-to-end against prod via `/wallet/demo-c2b`: matched number credits a wallet; unknown number lands as unresolved; admin repost credits and flips to reposted; refund flips to refunded; totals update.

## Out of scope

Live Daraja C2B/B2C, C2B validation-URL rejection (we accept-and-reconcile), the paste-your-message chatbot.
