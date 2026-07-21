-- RTP risk monitor + manual game pause.

-- Speeds the rolling-window realized-RTP query over settled bets.
CREATE INDEX IF NOT EXISTS idx_bets_game_type_settled
  ON bets (game_type, settled_at) WHERE status IN ('won', 'lost');

-- Per-game availability flags (manual pause). Default enabled.
INSERT INTO game_settings (key, value) VALUES
  ('crash_enabled', 'true'), ('mines_enabled', 'true'), ('dice_enabled', 'true'),
  ('scratch_enabled', 'true'), ('lottery_enabled', 'true')
  ON CONFLICT (key) DO NOTHING;

-- RTP monitor config (warn-only). warnRtp per game; expected RTP is ~95% for the
-- edge games and ~76% for scratch.
INSERT INTO game_settings (key, value) VALUES
  ('rtp_monitor', '{"windowMinutes":60,"minBets":200,"reAlertMinutes":60,"warnRtp":{"crash":1.02,"mines":1.02,"dice":1.02,"scratch":0.90}}')
  ON CONFLICT (key) DO NOTHING;
