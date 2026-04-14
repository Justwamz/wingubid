CREATE TABLE payment_transactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id        UUID NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  wallet_id        UUID NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  type             VARCHAR(20) NOT NULL CHECK (type IN ('deposit', 'withdrawal')),
  provider         VARCHAR(20) NOT NULL CHECK (provider IN ('mpesa', 'mtn', 'airtel')),
  amount           BIGINT NOT NULL CHECK (amount > 0),
  currency         CHAR(3) NOT NULL,
  status           VARCHAR(20) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'awaiting_callback', 'completed', 'failed')),
  idempotency_key  VARCHAR(255) UNIQUE NOT NULL,
  provider_ref     VARCHAR(255),
  failure_reason   TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payment_transactions_player_id ON payment_transactions(player_id);
CREATE INDEX idx_payment_transactions_provider_ref ON payment_transactions(provider_ref)
  WHERE provider_ref IS NOT NULL;
