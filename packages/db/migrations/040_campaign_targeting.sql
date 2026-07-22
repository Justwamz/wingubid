ALTER TABLE bonus_campaigns
  ADD COLUMN IF NOT EXISTS code     VARCHAR(40),
  ADD COLUMN IF NOT EXISTS criteria JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bonus_campaigns_code
  ON bonus_campaigns(code) WHERE code IS NOT NULL;
