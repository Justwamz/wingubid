ALTER TABLE bonus_campaigns
  ADD COLUMN IF NOT EXISTS match_percent     INT,
  ADD COLUMN IF NOT EXISTS max_match_cents   BIGINT,
  ADD COLUMN IF NOT EXISTS min_deposit_cents BIGINT;

ALTER TABLE bonus_campaigns DROP CONSTRAINT IF EXISTS bonus_campaigns_type_check;
ALTER TABLE bonus_campaigns ADD CONSTRAINT bonus_campaigns_type_check
  CHECK (type IN ('welcome','custom','deposit_match'));

ALTER TABLE bonus_campaigns DROP CONSTRAINT IF EXISTS bonus_campaigns_reward_kind_check;
ALTER TABLE bonus_campaigns ADD CONSTRAINT bonus_campaigns_reward_kind_check
  CHECK (reward_kind IN ('fixed','deposit_match'));

ALTER TABLE bonus_campaigns ALTER COLUMN amount_cents DROP NOT NULL;
ALTER TABLE bonus_campaigns DROP CONSTRAINT IF EXISTS bonus_campaigns_amount_cents_check;
ALTER TABLE bonus_campaigns ADD CONSTRAINT bonus_campaigns_reward_shape_check CHECK (
  (reward_kind = 'fixed' AND amount_cents IS NOT NULL AND amount_cents > 0)
  OR
  (reward_kind = 'deposit_match' AND match_percent > 0 AND max_match_cents > 0 AND min_deposit_cents >= 0)
);
