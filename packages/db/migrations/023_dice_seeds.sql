-- H2/H4: provably-fair dice. One active server seed per player, its hash
-- committed up front (players see the hash before betting), the raw seed
-- revealed only on rotation, and a monotonic per-player nonce incremented
-- atomically per roll (replaces the racy COUNT(*)-based nonce).
CREATE TABLE IF NOT EXISTS dice_seeds (
  player_id        UUID PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  server_seed      TEXT   NOT NULL,
  server_seed_hash TEXT   NOT NULL,
  client_seed      TEXT   NOT NULL,
  nonce            BIGINT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rotated_at       TIMESTAMPTZ
);
