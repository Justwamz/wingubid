CREATE TABLE country_settings (
  country                    CHAR(2) PRIMARY KEY,
  currency                   CHAR(3)  NOT NULL,
  min_deposit                BIGINT   NOT NULL DEFAULT 0,
  max_deposit                BIGINT,
  min_withdrawal             BIGINT   NOT NULL DEFAULT 0,
  max_withdrawal             BIGINT,
  daily_withdrawal_limit     BIGINT,
  remittance_cron            VARCHAR(100) NOT NULL DEFAULT '0 0 * * *',
  tax_authority_bank_account JSONB,
  remittance_enabled         BOOLEAN  NOT NULL DEFAULT false,
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO country_settings (country, currency) VALUES
  ('KE', 'KES'),
  ('UG', 'UGX'),
  ('TZ', 'TZS'),
  ('RW', 'RWF');

CREATE TABLE provider_games (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider  VARCHAR(50)  NOT NULL,
  game_id   VARCHAR(255) NOT NULL,
  name      VARCHAR(255) NOT NULL,
  game_type VARCHAR(20)  NOT NULL CHECK (game_type IN ('slot','virtual_sport')),
  enabled   BOOLEAN      NOT NULL DEFAULT true,
  metadata  JSONB,
  UNIQUE(provider, game_id)
);

INSERT INTO tax_rules (country, tax_type, rate, enabled) VALUES
  ('KE', 'wager_tax',      12.50, true),
  ('KE', 'withdrawal_tax', 20.00, true),
  ('UG', 'wager_tax',       0.00, false),
  ('UG', 'withdrawal_tax',  0.00, false),
  ('TZ', 'wager_tax',       0.00, false),
  ('TZ', 'withdrawal_tax',  0.00, false),
  ('RW', 'wager_tax',       0.00, false),
  ('RW', 'withdrawal_tax',  0.00, false);
