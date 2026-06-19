-- Payment gateway configuration managed via admin portal
CREATE TABLE payment_configs (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  provider    VARCHAR(20)  NOT NULL UNIQUE,          -- 'mpesa', 'airtel'
  enabled     BOOLEAN      NOT NULL DEFAULT false,
  environment VARCHAR(10)  NOT NULL DEFAULT 'sandbox', -- 'sandbox', 'production'
  config      JSONB        NOT NULL DEFAULT '{}',     -- provider-specific credentials
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Seed empty rows for each supported provider
INSERT INTO payment_configs (provider, enabled, environment, config) VALUES
  ('mpesa',  false, 'sandbox', '{}'),
  ('airtel', false, 'sandbox', '{}');
