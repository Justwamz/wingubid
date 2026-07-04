-- H6: indexes for hot read paths that previously did full scans/sorts.
-- Plain CREATE INDEX (migrations run inside a transaction, so CONCURRENTLY is
-- not available). On a large table this briefly locks writes; acceptable here
-- and these run once. IF NOT EXISTS keeps the migration idempotent.

-- Player game history: WHERE player_id ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_bets_player_id_created_at ON bets (player_id, created_at DESC);

-- Admin recent-bets / stats: ORDER BY created_at DESC LIMIT n
CREATE INDEX IF NOT EXISTS idx_bets_created_at ON bets (created_at DESC);

-- Leaderboard: WHERE status='won' AND winnings IS NOT NULL ORDER BY settled_at DESC
CREATE INDEX IF NOT EXISTS idx_bets_won_settled_at ON bets (settled_at DESC)
  WHERE status = 'won' AND winnings IS NOT NULL;

-- Admin stats SUM(amount) aggregates: WHERE type = ... [AND status = 'completed']
CREATE INDEX IF NOT EXISTS idx_transactions_type_status ON transactions (type, status);

-- Admin players list: ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_players_created_at ON players (created_at DESC);

-- Withdrawal aggregates (admin stats): WHERE type='withdrawal' AND status='completed'
CREATE INDEX IF NOT EXISTS idx_payment_transactions_type_status ON payment_transactions (type, status);

-- Admin withdrawals list: WHERE type='withdrawal' ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_payment_transactions_type_created_at ON payment_transactions (type, created_at DESC);

-- Player withdrawals list + daily-limit check: WHERE player_id AND type ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_payment_transactions_player_type_created_at ON payment_transactions (player_id, type, created_at DESC);
