ALTER TABLE banners
  ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES bonus_campaigns(id);
