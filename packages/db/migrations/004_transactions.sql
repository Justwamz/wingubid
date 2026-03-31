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
