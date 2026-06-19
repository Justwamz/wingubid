CREATE TABLE IF NOT EXISTS game_providers (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(100) NOT NULL,
  slug       VARCHAR(50)  NOT NULL UNIQUE,
  base_url   VARCHAR(500) NOT NULL DEFAULT '',
  api_key    TEXT         NOT NULL DEFAULT '',
  api_secret TEXT         NOT NULL DEFAULT '',
  active     BOOLEAN      NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
