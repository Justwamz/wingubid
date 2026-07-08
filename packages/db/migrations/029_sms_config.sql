-- SMS / OTP provider configuration managed via the admin Integrations page.
-- Singleton (one active SMS provider). `enabled` is the live switch for OTP:
-- when on, registration sends a real OTP and login requires a verified phone;
-- when off, the system simulates SMS and auto-verifies (demo behaviour).
CREATE TABLE IF NOT EXISTS sms_configs (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  provider    VARCHAR(30)  NOT NULL UNIQUE DEFAULT 'africastalking',
  enabled     BOOLEAN      NOT NULL DEFAULT false,
  config      JSONB        NOT NULL DEFAULT '{}',   -- { apiKey, username, senderId }
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO sms_configs (provider, enabled, config)
VALUES ('africastalking', false, '{}')
ON CONFLICT (provider) DO NOTHING;
