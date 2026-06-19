-- The provider_games table may exist from an earlier schema that is incompatible
-- with the current one (missing game_slug, active, etc.). Drop and recreate so we
-- always end up with the correct schema. Safe because the table had no real data
-- (it was created by a failed/rolled-back deploy before migrations were recorded).
DROP TABLE IF EXISTS provider_games;

CREATE TABLE provider_games (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id         UUID         NOT NULL REFERENCES game_providers(id) ON DELETE CASCADE,
  game_slug           VARCHAR(50)  NOT NULL,
  provider_game_id    VARCHAR(200) NOT NULL DEFAULT '',
  launch_url_template TEXT         NOT NULL DEFAULT '',
  active              BOOLEAN      NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(game_slug)
);

CREATE INDEX idx_provider_games_slug_active ON provider_games(game_slug) WHERE active = true;
