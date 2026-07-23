ALTER TABLE scratch_cards
  ADD COLUMN IF NOT EXISTS fund_source        VARCHAR(10) NOT NULL DEFAULT 'cash'
    CHECK (fund_source IN ('cash','bonus')),
  ADD COLUMN IF NOT EXISTS bonus_grant_id     UUID REFERENCES bonus_grants(id),
  ADD COLUMN IF NOT EXISTS net_credited_cents BIGINT;
