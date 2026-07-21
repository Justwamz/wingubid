-- Per-game live chat + moderation (Wingu Crash first).

-- Public chat handle (never expose phone/legal name). Case-insensitive unique.
ALTER TABLE players ADD COLUMN chat_username VARCHAR(20);
CREATE UNIQUE INDEX idx_players_chat_username ON players (LOWER(chat_username));

CREATE TABLE chat_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game       VARCHAR(30)  NOT NULL,
  player_id  UUID         NOT NULL REFERENCES players(id),
  username   VARCHAR(20)  NOT NULL,
  text       VARCHAR(500) NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES admin_users(id)
);
CREATE INDEX idx_chat_messages_game_created ON chat_messages (game, created_at DESC);

-- until IS NULL means a permanent ban.
CREATE TABLE chat_bans (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  UUID NOT NULL REFERENCES players(id),
  until      TIMESTAMPTZ,
  reason     TEXT,
  created_by VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_chat_bans_player ON chat_bans (player_id, created_at DESC);

CREATE TABLE chat_banned_words (
  word       VARCHAR(50) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO chat_banned_words (word, created_by) VALUES
  ('fuck','system'), ('shit','system'), ('bitch','system'),
  ('asshole','system'), ('nigger','system'), ('cunt','system')
  ON CONFLICT DO NOTHING;

CREATE TABLE chat_strikes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  UUID NOT NULL REFERENCES players(id),
  reason     VARCHAR(30) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_chat_strikes_player_created ON chat_strikes (player_id, created_at DESC);

INSERT INTO game_settings (key, value) VALUES
  ('chat:crash:enabled', 'true'),
  ('chat:autoban', '{"windowMin":10,"strikeThreshold":3}')
  ON CONFLICT (key) DO NOTHING;
