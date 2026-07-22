CREATE TABLE IF NOT EXISTS bonus_campaigns (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key           VARCHAR(40) UNIQUE NOT NULL,
  name          VARCHAR(120) NOT NULL,
  description   VARCHAR(500),
  type          VARCHAR(20) NOT NULL CHECK (type IN ('welcome','custom')),
  reward_kind   VARCHAR(20) NOT NULL DEFAULT 'fixed' CHECK (reward_kind IN ('fixed')),
  amount_cents  BIGINT NOT NULL CHECK (amount_cents > 0),
  expiry_days   INT NOT NULL DEFAULT 30 CHECK (expiry_days BETWEEN 1 AND 365),
  starts_at     TIMESTAMPTZ,
  ends_at       TIMESTAMPTZ,
  status        VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','ended')),
  created_by    UUID REFERENCES admin_users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bonus_claims (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES bonus_campaigns(id),
  player_id   UUID NOT NULL REFERENCES players(id),
  grant_id    UUID REFERENCES bonus_grants(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_bonus_claims_player ON bonus_claims(player_id);

ALTER TABLE bonus_grants DROP CONSTRAINT IF EXISTS bonus_grants_source_check;
ALTER TABLE bonus_grants ADD CONSTRAINT bonus_grants_source_check
  CHECK (source IN ('manual','campaign'));
ALTER TABLE bonus_grants ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES bonus_campaigns(id);
