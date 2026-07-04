-- H2: provably-fair scratch. Same per-player commit/reveal model as dice_seeds:
-- one active server seed per player, hash committed up front, raw seed revealed
-- only on rotation, nonce incremented atomically per card.
CREATE TABLE IF NOT EXISTS scratch_seeds (
  player_id        UUID PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  server_seed      TEXT   NOT NULL,
  server_seed_hash TEXT   NOT NULL,
  client_seed      TEXT   NOT NULL,
  nonce            BIGINT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rotated_at       TIMESTAMPTZ
);
