-- Fraud/abuse signals per player. Extensible via `kind` (Slice 3 adds 'claim').
CREATE TABLE IF NOT EXISTS player_signals (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  kind       VARCHAR(12) NOT NULL CHECK (kind IN ('signup','login','claim')),
  ip         INET,
  device_id  VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_player_signals_player_id ON player_signals(player_id);
CREATE INDEX IF NOT EXISTS idx_player_signals_ip ON player_signals(ip) WHERE ip IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_player_signals_device ON player_signals(device_id) WHERE device_id IS NOT NULL;
