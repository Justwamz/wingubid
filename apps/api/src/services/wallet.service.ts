import type { PoolClient } from '@betting/db'
import { pool } from '@betting/db'
import { AppError } from '../lib/errors.js'

export interface WalletBalance {
  walletId: string
  balance: number
  bonusBalance: number
  lockedBalance: number
  currency: string
}

type WalletRow = { id: string; balance: string; currency: string }

async function selectWalletForUpdate(
  client: PoolClient,
  playerId: string,
): Promise<WalletRow> {
  const { rows } = await client.query<WalletRow>(
    `SELECT id, balance, currency FROM wallets WHERE player_id = $1 FOR UPDATE`,
    [playerId],
  )
  if (rows.length === 0) throw new AppError('WALLET_NOT_FOUND', "We couldn't find your wallet. Please contact support.", 404)
  return rows[0]
}

export async function getWalletBalance(playerId: string): Promise<WalletBalance> {
  const { rows } = await pool.query<{
    wallet_id: string; balance: string; bonus_balance: string
    locked_balance: string; currency: string
  }>(
    `SELECT id AS wallet_id, balance, bonus_balance, locked_balance, currency
     FROM wallets WHERE player_id = $1`,
    [playerId],
  )
  if (rows.length === 0) throw new AppError('WALLET_NOT_FOUND', 'Wallet not found', 404)
  const w = rows[0]
  return {
    walletId: w.wallet_id,
    balance: Number(w.balance),
    bonusBalance: Number(w.bonus_balance),
    lockedBalance: Number(w.locked_balance),
    currency: w.currency,
  }
}

export async function debitForBet(
  client: PoolClient,
  playerId: string,
  grossStake: number,
  effectiveStake: number,
  metadata: Record<string, unknown>,
  opts: { lock?: boolean; idempotencyKey?: string } = {},
): Promise<{ transactionId: string; walletId: string }> {
  // Backstop against non-positive / malformed stakes reaching the ledger. A
  // negative grossStake would turn the debit below into a credit; an
  // effectiveStake above grossStake would inflate locked_balance. Callers
  // should validate their inputs, but this guarantees the invariant here too.
  if (
    !Number.isInteger(grossStake) || grossStake <= 0 ||
    !Number.isInteger(effectiveStake) || effectiveStake < 0 ||
    effectiveStake > grossStake
  ) {
    throw new AppError('INVALID_STAKE', "That bet amount isn't valid.", 400)
  }

  // Only games that settle in a LATER request (crash cashout, mines reveal,
  // lottery draw) should reserve locked_balance - they must release it on
  // settlement. Instant/externally-settled bets (dice, scratch, provider
  // debit) settle in this same transaction, so they must NOT lock, otherwise
  // locked_balance grows forever (nothing ever releases it).
  const lock = opts.lock ?? true

  const wallet = await selectWalletForUpdate(client, playerId)
  if (Number(wallet.balance) < grossStake) {
    throw new AppError('INSUFFICIENT_FUNDS', "You don't have enough balance for this.", 422)
  }

  const { rows: updated } = await client.query<{ balance: string }>(
    `UPDATE wallets
     SET balance = balance - $1, locked_balance = locked_balance + $2
     WHERE player_id = $3
     RETURNING balance`,
    [grossStake, lock ? effectiveStake : 0, playerId],
  )

  const { rows: txRows } = await client.query<{ id: string }>(
    `INSERT INTO transactions (wallet_id, player_id, type, amount, balance_after, status, metadata, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [wallet.id, playerId, 'bet_placed', effectiveStake, Number(updated[0].balance), 'completed', JSON.stringify(metadata), opts.idempotencyKey ?? null],
  )

  return { transactionId: txRows[0].id, walletId: wallet.id }
}

export async function creditDeposit(
  client: PoolClient,
  playerId: string,
  amount: number,
  idempotencyKey: string,
  metadata: Record<string, unknown>,
): Promise<{ transactionId: string; walletId: string }> {
  const wallet = await selectWalletForUpdate(client, playerId)

  const { rows: updated } = await client.query<{ balance: string }>(
    `UPDATE wallets SET balance = balance + $1 WHERE player_id = $2 RETURNING balance`,
    [amount, playerId],
  )

  const { rows: txRows } = await client.query<{ id: string }>(
    `INSERT INTO transactions (wallet_id, player_id, type, amount, balance_after, status, idempotency_key, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [wallet.id, playerId, 'deposit', amount, Number(updated[0].balance), 'completed', idempotencyKey, JSON.stringify(metadata)],
  )

  return { transactionId: txRows[0].id, walletId: wallet.id }
}

export async function lockForWithdrawal(
  client: PoolClient,
  playerId: string,
  amount: number,
): Promise<{ walletId: string }> {
  const wallet = await selectWalletForUpdate(client, playerId)
  if (Number(wallet.balance) < amount) {
    throw new AppError('INSUFFICIENT_FUNDS', "You don't have enough balance for this.", 422)
  }

  await client.query(
    `UPDATE wallets SET balance = balance - $1, locked_balance = locked_balance + $1 WHERE player_id = $2`,
    [amount, playerId],
  )

  return { walletId: wallet.id }
}

export async function settleWithdrawal(
  client: PoolClient,
  playerId: string,
  amount: number,
  netPayout: number,
  success: boolean,
  metadata: Record<string, unknown>,
): Promise<void> {
  const wallet = await selectWalletForUpdate(client, playerId)

  if (success) {
    const { rows: updated } = await client.query<{ balance: string }>(
      `UPDATE wallets SET locked_balance = locked_balance - $1 WHERE player_id = $2 RETURNING balance`,
      [amount, playerId],
    )
    await client.query(
      `INSERT INTO transactions (wallet_id, player_id, type, amount, balance_after, status, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [wallet.id, playerId, 'withdrawal', netPayout, Number(updated[0]?.balance), 'completed', JSON.stringify(metadata)],
    )
  } else {
    const { rows: updated } = await client.query<{ balance: string }>(
      `UPDATE wallets
       SET locked_balance = locked_balance - $1, balance = balance + $2
       WHERE player_id = $3
       RETURNING balance`,
      [amount, amount, playerId],
    )
    await client.query(
      `INSERT INTO transactions (wallet_id, player_id, type, amount, balance_after, status, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [wallet.id, playerId, 'withdrawal', netPayout, Number(updated[0]?.balance), 'failed', JSON.stringify(metadata)],
    )
  }
}

export async function creditWinnings(
  client: PoolClient,
  playerId: string,
  amount: number,
  metadata: Record<string, unknown>,
  // When provided, written into the row's UNIQUE idempotency_key so a duplicate
  // credit (e.g. a retried provider callback) violates the constraint instead of
  // crediting twice.
  idempotencyKey?: string,
): Promise<{ transactionId: string; walletId: string }> {
  const wallet = await selectWalletForUpdate(client, playerId)

  const { rows: updated } = await client.query<{ balance: string }>(
    `UPDATE wallets SET balance = balance + $1 WHERE player_id = $2 RETURNING balance`,
    [amount, playerId],
  )

  const { rows: txRows } = await client.query<{ id: string }>(
    `INSERT INTO transactions (wallet_id, player_id, type, amount, balance_after, status, metadata, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [wallet.id, playerId, 'bet_won', amount, Number(updated[0].balance), 'completed', JSON.stringify(metadata), idempotencyKey ?? null],
  )

  return { transactionId: txRows[0].id, walletId: wallet.id }
}

export async function creditDemoTopup(
  client: PoolClient,
  playerId: string,
  amount: number,
): Promise<{ balance: number }> {
  const wallet = await selectWalletForUpdate(client, playerId)

  const { rows: updated } = await client.query<{ balance: string }>(
    `UPDATE wallets SET balance = balance + $1 WHERE player_id = $2 RETURNING balance`,
    [amount, playerId],
  )
  // Ledger row so demo credits are traceable like any other balance change.
  await client.query(
    `INSERT INTO transactions (wallet_id, player_id, type, amount, balance_after, status, metadata)
     VALUES ($1, $2, 'demo_topup', $3, $4, 'completed', '{"demo":true}')`,
    [wallet.id, playerId, amount, Number(updated[0].balance)],
  )
  return { balance: Number(updated[0].balance) }
}

export async function refundBet(
  client: PoolClient,
  playerId: string,
  amount: number,
  metadata: Record<string, unknown>,
): Promise<{ transactionId: string; walletId: string }> {
  const wallet = await selectWalletForUpdate(client, playerId)

  const { rows: updated } = await client.query<{ balance: string }>(
    `UPDATE wallets
     SET locked_balance = locked_balance - $1, balance = balance + $1
     WHERE player_id = $2
     RETURNING balance`,
    [amount, playerId],
  )

  const { rows: txRows } = await client.query<{ id: string }>(
    `INSERT INTO transactions (wallet_id, player_id, type, amount, balance_after, status, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [wallet.id, playerId, 'bet_refunded', amount, Number(updated[0].balance), 'completed', JSON.stringify(metadata)],
  )

  return { transactionId: txRows[0].id, walletId: wallet.id }
}

// ---- Bonus wallet -----------------------------------------------------------

// Credit a fresh manual bonus into the player's bonus wallet and open a grant.
// The partial unique index on bonus_grants(player_id) WHERE status='active'
// guarantees at most one active grant; a second concurrent grant violates it.
export async function grantBonus(
  client: PoolClient,
  playerId: string,
  amount: number,
  grantedBy: string,
  expiresAt: Date,
): Promise<{ grantId: string }> {
  const wallet = await selectWalletForUpdate(client, playerId)
  const { rows: grantRows } = await client.query<{ id: string }>(
    `INSERT INTO bonus_grants (player_id, wallet_id, source, amount_granted, remaining, status, granted_by, expires_at)
     VALUES ($1, $2, 'manual', $3, $3, 'active', $4, $5) RETURNING id`,
    [playerId, wallet.id, amount, grantedBy, expiresAt],
  )
  const { rows: updated } = await client.query<{ bonus_balance: string }>(
    `UPDATE wallets SET bonus_balance = bonus_balance + $1 WHERE player_id = $2 RETURNING bonus_balance`,
    [amount, playerId],
  )
  await client.query(
    `INSERT INTO transactions (wallet_id, player_id, type, amount, balance_after, status, metadata)
     VALUES ($1, $2, 'bonus_granted', $3, $4, 'completed', $5::jsonb)`,
    [wallet.id, playerId, amount, Number(updated[0].bonus_balance), JSON.stringify({ grantId: grantRows[0].id, grantedBy })],
  )
  return { grantId: grantRows[0].id }
}

// Debit a bonus-funded stake from the active grant. No locked_balance: the stake
// leaves the bonus wallet outright (never returned on a normal loss). Throws if
// there is no usable active grant or it is expired / underfunded.
export async function debitBonusForBet(
  client: PoolClient,
  playerId: string,
  stake: number,
  metadata: Record<string, unknown>,
): Promise<{ walletId: string; grantId: string }> {
  if (!Number.isInteger(stake) || stake <= 0) {
    throw new AppError('INVALID_STAKE', "That bet amount isn't valid.", 400)
  }
  const wallet = await selectWalletForUpdate(client, playerId)
  const { rows: grants } = await client.query<{ id: string; remaining: string; expires_at: string | null }>(
    `SELECT id, remaining, expires_at FROM bonus_grants
     WHERE player_id = $1 AND status = 'active' FOR UPDATE`,
    [playerId],
  )
  if (grants.length === 0) throw new AppError('NO_ACTIVE_BONUS', "You don't have an active bonus.", 422)
  const grant = grants[0]
  if (grant.expires_at && new Date(grant.expires_at).getTime() <= Date.now()) {
    // Do NOT forfeit here: this runs inside the caller's game transaction,
    // which always ROLLBACKs after this throw, undoing any write we made.
    // Actual forfeiture happens in the committed sweepExpiredBonuses() job.
    throw new AppError('NO_ACTIVE_BONUS', 'Your bonus has expired.', 422)
  }
  if (Number(grant.remaining) < stake) {
    throw new AppError('INSUFFICIENT_BONUS', "You don't have enough bonus for this.", 422)
  }

  const { rows: updated } = await client.query<{ bonus_balance: string }>(
    `UPDATE wallets SET bonus_balance = bonus_balance - $1 WHERE player_id = $2 RETURNING bonus_balance`,
    [stake, playerId],
  )
  const newRemaining = Number(grant.remaining) - stake
  await client.query(
    `UPDATE bonus_grants SET remaining = $1, status = CASE WHEN $1 = 0 THEN 'exhausted' ELSE status END WHERE id = $2`,
    [newRemaining, grant.id],
  )
  await client.query(
    `INSERT INTO transactions (wallet_id, player_id, type, amount, balance_after, status, metadata)
     VALUES ($1, $2, 'bonus_bet', $3, $4, 'completed', $5::jsonb)`,
    [wallet.id, playerId, stake, Number(updated[0].bonus_balance), JSON.stringify({ ...metadata, grantId: grant.id })],
  )
  return { walletId: wallet.id, grantId: grant.id }
}

// Settle a winning bonus bet: credit net = min(payout - stake, cap) to CASH.
// `capped` is true when the raw profit exceeded the cap (so the UI can say so).
export async function settleBonusWin(
  client: PoolClient,
  playerId: string,
  grantId: string,
  payout: number,
  stake: number,
  betId: string,
  maxWinCents: number,
): Promise<{ net: number; capped: boolean }> {
  const profit = Math.max(payout - stake, 0)
  const net = Math.min(profit, maxWinCents)
  const capped = profit > maxWinCents
  if (net <= 0) return { net: 0, capped }
  const wallet = await selectWalletForUpdate(client, playerId)
  const { rows: updated } = await client.query<{ balance: string }>(
    `UPDATE wallets SET balance = balance + $1 WHERE player_id = $2 RETURNING balance`,
    [net, playerId],
  )
  await client.query(
    `INSERT INTO transactions (wallet_id, player_id, type, amount, balance_after, status, metadata)
     VALUES ($1, $2, 'bonus_won', $3, $4, 'completed', $5::jsonb)`,
    [wallet.id, playerId, net, Number(updated[0].balance), JSON.stringify({ grantId, betId, payout, stake })],
  )
  return { net, capped }
}

// Return a bonus stake to the bonus wallet (voided in-flight round).
export async function refundBonusBet(
  client: PoolClient,
  playerId: string,
  grantId: string,
  stake: number,
  metadata: Record<string, unknown>,
): Promise<void> {
  const wallet = await selectWalletForUpdate(client, playerId)
  const { rows: updated } = await client.query<{ bonus_balance: string }>(
    `UPDATE wallets SET bonus_balance = bonus_balance + $1 WHERE player_id = $2 RETURNING bonus_balance`,
    [stake, playerId],
  )
  await client.query(
    `UPDATE bonus_grants SET remaining = remaining + $1,
       status = CASE WHEN status = 'exhausted' THEN 'active' ELSE status END
     WHERE id = $2`,
    [stake, grantId],
  )
  await client.query(
    `INSERT INTO transactions (wallet_id, player_id, type, amount, balance_after, status, metadata)
     VALUES ($1, $2, 'bonus_refunded', $3, $4, 'completed', $5::jsonb)`,
    [wallet.id, playerId, stake, Number(updated[0].bonus_balance), JSON.stringify({ ...metadata, grantId })],
  )
}

// Zero out and close a grant (expiry / revoke). Writes a forfeited ledger row.
export async function forfeitBonus(
  client: PoolClient,
  grantId: string,
  reason: 'expired' | 'revoked',
): Promise<void> {
  const { rows } = await client.query<{ player_id: string; wallet_id: string; remaining: string }>(
    `SELECT player_id, wallet_id, remaining FROM bonus_grants WHERE id = $1 FOR UPDATE`,
    [grantId],
  )
  if (rows.length === 0) return
  const g = rows[0]
  const remaining = Number(g.remaining)
  const { rows: updated } = await client.query<{ bonus_balance: string }>(
    `UPDATE wallets SET bonus_balance = GREATEST(bonus_balance - $1, 0) WHERE id = $2 RETURNING bonus_balance`,
    [remaining, g.wallet_id],
  )
  await client.query(
    `UPDATE bonus_grants SET remaining = 0, status = $2 WHERE id = $1`,
    [grantId, reason],
  )
  if (remaining > 0) {
    await client.query(
      `INSERT INTO transactions (wallet_id, player_id, type, amount, balance_after, status, metadata)
       VALUES ($1, $2, 'bonus_forfeited', $3, $4, 'completed', $5::jsonb)`,
      [g.wallet_id, g.player_id, remaining, Number(updated[0].bonus_balance), JSON.stringify({ grantId, reason })],
    )
  }
}

// Sweep and forfeit all bonus grants that have passed their expires_at but are
// still 'active' (debitBonusForBet rejects betting them but, being inside the
// caller's transaction, can never commit the forfeit itself). Each grant is
// forfeited in its own committed transaction, locking the wallet FIRST via
// selectWalletForUpdate - the same order debitBonusForBet uses - so a
// concurrent bonus bet on the same player can never deadlock against this
// sweep (ABBA: wallet-then-grant vs grant-then-wallet). One grant's failure
// is rolled back and logged without aborting the rest of the sweep.
export async function sweepExpiredBonuses(): Promise<number> {
  const { rows: expired } = await pool.query<{ id: string; player_id: string }>(
    `SELECT id, player_id FROM bonus_grants
     WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= NOW()`,
  )

  let forfeited = 0
  for (const grant of expired) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await selectWalletForUpdate(client, grant.player_id)
      await forfeitBonus(client, grant.id, 'expired')
      await client.query('COMMIT')
      forfeited++
    } catch (err) {
      await client.query('ROLLBACK')
      console.error(`[bonus-sweep] failed to forfeit grant ${grant.id}`, err)
    } finally {
      client.release()
    }
  }
  return forfeited
}
