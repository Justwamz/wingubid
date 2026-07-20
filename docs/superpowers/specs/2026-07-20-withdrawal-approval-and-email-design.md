# Withdrawal email alerts + maker-checker approval - Design

**Date:** 2026-07-20
**Status:** Approved

## Goal

1. Email `withdrawals@wingubet.com` on every withdrawal initiation and on each
   approval decision.
2. Admin-configurable **approval threshold** (default KES 1,000). Withdrawals
   above it require a second approval before payout (customer = maker, risk
   admin = checker).
3. Only **finance** and **super_admin** roles may approve/reject. Every decision
   is audit-logged.

Runs through the existing stub (M-Pesa payout still stubbed). Email uses a
transactional API (Resend or SendGrid), admin-configurable, and simulates/logs
when unconfigured (like SMS).

## Data (migration 033)

- Extend `payment_transactions.status` CHECK to add `awaiting_approval` and `rejected`.
- Seed `game_settings('withdrawal_approval_threshold', '100000')` (cents = KES 1,000).
- New `email_configs` (singleton, mirrors `sms_configs`): `enabled`, `config` JSONB
  (`{provider, apiKey, fromEmail, toEmail}`; toEmail defaults to withdrawals@wingubet.com).

## Email (new)

- `email-config.service.ts`: `getEmailConfig()` (30s cache) + `invalidateEmailConfigCache()`.
- `email.service.ts`: `sendEmail({subject, html, to?})` - Resend or SendGrid via
  `fetch`; if disabled / no apiKey / no from, log `[EMAIL SIMULATION]` and return.
  Send failures are caught and never break the withdrawal.
- `notifyWithdrawal(event, details)` for the four events (initiated, needs_approval,
  approved, rejected) -> emails `toEmail`.

## Threshold

`game-settings.service.ts`: `getWithdrawalThreshold()` (default 100000) /
`setWithdrawalThreshold(cents)`.

## Flow (maker-checker) - `payment.service.ts`

`initiateWithdrawal`: after locking funds + inserting the row:
- read threshold.
- **amount > threshold** -> set `awaiting_approval` (do NOT call provider; funds stay
  locked). `notifyWithdrawal('needs_approval')`. Returns `{ transactionId, status:'awaiting_approval' }`.
- **else** -> call provider, `awaiting_callback` (today's path). `notifyWithdrawal('initiated')`.

`approveWithdrawal(id, adminId)`: lock row, require `awaiting_approval`, flip to
`awaiting_callback` under the lock (blocks double-approve), call provider, store
provider_ref; audit-log + `notifyWithdrawal('approved')`.

`rejectWithdrawal(id, adminId, reason?)`: lock row, require `awaiting_approval`,
`settleWithdrawal(..., success=false)` to return funds, set `rejected`; audit-log +
`notifyWithdrawal('rejected')`.

Audit rows go to `admin_audit_log` (admin_id, action, entity, entity_id, before, after).

## API routes

- `POST /admin/withdrawals/:id/approve` - role-gated (finance/super_admin).
- `POST /admin/withdrawals/:id/reject` `{ reason? }` - role-gated.
- `GET /admin/withdrawal-config` -> `{ approvalThreshold }`.
- `PUT /admin/withdrawal-config` `{ approvalThreshold }` - role-gated.
- `GET/PUT /admin/email-config` - mirrors sms-config (apiKey masked, cache invalidated).

Role gate: reject with 403 if `req.adminRole` not in {finance, super_admin}.

## Admin UI

- **Withdrawals tab**: editable approval threshold (KES) at the top; **Approve** /
  **Reject** actions on `awaiting_approval` rows; new statuses in the filter + colours.
- **Integrations tab**: Email provider card (provider select, API key [masked],
  from-email, to-email, enabled) -> `/admin/email-config`.

## Testing

`tsc` + unit tests for the email simulate path and threshold routing. End-to-end via
prod against `/wallet/withdraw` with the QA token: below-threshold auto-proceeds;
above-threshold lands `awaiting_approval` (funds locked, not paid); approve proceeds;
reject returns funds; emails log `[EMAIL SIMULATION]`. Role gate returns 403 for
non-approver roles (verified by unit test since only super_admin is seeded).

## Out of scope

Real Resend/SendGrid sending (needs an account + verified sender domain), real
M-Pesa payout, per-country thresholds, two-admin (dual) approval.
