CREATE TABLE game_settings (
  key        VARCHAR(100) PRIMARY KEY,
  value      JSONB        NOT NULL,
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO game_settings (key, value) VALUES
  ('crash_house_edge',      '5'),
  ('crash_waiting_seconds', '5'),
  ('mines_house_edge',      '5'),
  ('dice_house_edge',       '1');
