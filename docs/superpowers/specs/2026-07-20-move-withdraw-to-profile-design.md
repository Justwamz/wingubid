# Move Withdraw from nav → Profile — Design

**Date:** 2026-07-20
**Status:** Approved

## Goal

De-emphasize withdrawals by removing the Withdraw entry from the main navigation
and surfacing it inside the player's Profile (dashboard) page instead. The
withdraw capability stays fully functional and discoverable — only the entry
point moves. This keeps the product on the right side of the "de-emphasize vs.
hide" line (a responsible-gambling / trust consideration).

## Scope

Presentational routing only. No changes to withdraw logic, API, or wallet
services. The withdraw page at `/wallet/withdraw` is untouched.

## Changes

### 1. Remove Withdraw from the nav
`apps/web/src/app/(player)/layout.tsx`
- Drop the `Withdraw` entry from the shared `navLinks` array (lines 48–53).
  This removes it from **both** the desktop top nav and the mobile bottom nav,
  which render from the same array.
- Remaining nav: Games · Deposit · Profile.

### 2. Withdraw button on the Balance card
`apps/web/src/app/(player)/dashboard/page.tsx`
- Add a quiet secondary `Withdraw →` link inside the existing Balance card.
  Styled subtly (not an accent button) so it is discoverable but not
  encouraged. Links to `/wallet/withdraw`.

### 3. "Account" actions section
`apps/web/src/app/(player)/dashboard/page.tsx`
- New titled section below the balance cards, above "Play a game", with a
  row-style link:
  - `↑ Withdraw` → `/wallet/withdraw`
- Structured to allow future rows (Transactions, Settings) but only Withdraw
  is added now (YAGNI — no transactions page exists yet).

## Design rationale

Deposit keeps two prominent entry points (nav link + accent "+ Top Up"
button); Withdraw gets two quiet entry points inside Profile. This achieves
"discoverable but not encouraged."

## Testing

Load the app and confirm:
- Withdraw is absent from both desktop and mobile nav.
- Both new Profile entry points render and route to `/wallet/withdraw`.
- Deposit / Top Up entry points unchanged.
