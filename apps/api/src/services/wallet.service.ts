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
  if (rows.length === 0) throw new AppError('WALLET_NOT_FOUND', 'Wallet not found', 404)
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
  opts: { lock?: boolean } = {},
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
    throw new AppError('INVALID_STAKE', 'Invalid stake amount', 400)
  }

  // Only games that settle in a LATER request (crash cashout, mines reveal,
  // lottery draw) should reserve locked_balance — they must release it on
  // settlement. Instant/externally-settled bets (dice, scratch, provider
  // debit) settle in this same transaction, so they must NOT lock, otherwise
  // locked_balance grows forever (nothing ever releases it).
  const lock = opts.lock ?? true

  const wallet = await selectWalletForUpdate(client, playerId)
  if (Number(wallet.balance) < grossStake) {
    throw new AppError('INSUFFICIENT_FUNDS', 'Insufficient balance', 422)
  }

  const { rows: updated } = await client.query<{ balance: string }>(
    `UPDATE wallets
     SET balance = balance - $1, locked_balance = locked_balance + $2
     WHERE player_id = $3
     RETURNING balance`,
    [grossStake, lock ? effectiveStake : 0, playerId],
  )

  const { rows: txRows } = await client.query<{ id: string }>(
    `INSERT INTO transactions (wallet_id, player_id, type, amount, balance_after, status, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [wallet.id, playerId, 'bet_placed', effectiveStake, Number(updated[0].balance), 'completed', JSON.stringify(metadata)],
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
    throw new AppError('INSUFFICIENT_FUNDS', 'Insufficient balance', 422)
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
): Promise<{ transactionId: string; walletId: string }> {
  const wallet = await selectWalletForUpdate(client, playerId)

  const { rows: updated } = await client.query<{ balance: string }>(
    `UPDATE wallets SET balance = balance + $1 WHERE player_id = $2 RETURNING balance`,
    [amount, playerId],
  )

  const { rows: txRows } = await client.query<{ id: string }>(
    `INSERT INTO transactions (wallet_id, player_id, type, amount, balance_after, status, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [wallet.id, playerId, 'bet_won', amount, Number(updated[0].balance), 'completed', JSON.stringify(metadata)],
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
