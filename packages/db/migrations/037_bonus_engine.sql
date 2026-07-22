-- Replace the unused placeholder grants table (wagering-requirement model we do
-- not use). Safe: no rows in production, no foreign keys reference it yet.
DROP TABLE IF EXISTS bonus_grants;

CREATE TABLE bonus_grants (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id      UUID   NOT NULL REFERENCES players(id),
  wallet_id      UUID   NOT NULL REFERENCES wallets(id),
  source         VARCHAR(20) NOT NULL DEFAULT 'manual'
                 CHECK (source IN ('manual')),
  amount_granted BIGINT NOT NULL CHECK (amount_granted > 0),
  remaining      BIGINT NOT NULL CHECK (remaining >= 0),
  status         VARCHAR(20) NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','exhausted','expired','revoked')),
  granted_by     UUID   REFERENCES admin_users(id),
  expires_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_bonus_grants_player_id ON bonus_grants(player_id);
CREATE UNIQUE INDEX uq_bonus_grants_one_active
  ON bonus_grants(player_id) WHERE status = 'active';

ALTER TABLE bets
  ADD COLUMN IF NOT EXISTS fund_source VARCHAR(10) NOT NULL DEFAULT 'cash'
    CHECK (fund_source IN ('cash','bonus')),
  ADD COLUMN IF NOT EXISTS bonus_grant_id UUID REFERENCES bonus_grants(id);

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_type_check
  CHECK (type IN (
    'deposit','withdrawal','bet_placed','bet_won','bet_refunded',
    'bonus_credit','bonus_wager','wager_tax','withdrawal_tax','demo_topup',
    'bonus_granted','bonus_bet','bonus_won','bonus_refunded','bonus_forfeited'
  ));
