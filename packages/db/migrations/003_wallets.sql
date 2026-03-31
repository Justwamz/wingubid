CREATE TABLE wallets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id       UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  currency        CHAR(3) NOT NULL,
  balance         BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  bonus_balance   BIGINT NOT NULL DEFAULT 0 CHECK (bonus_balance >= 0),
  locked_balance  BIGINT NOT NULL DEFAULT 0 CHECK (locked_balance >= 0),
  UNIQUE(player_id, currency)
);

CREATE INDEX idx_wallets_player_id ON wallets(player_id);
