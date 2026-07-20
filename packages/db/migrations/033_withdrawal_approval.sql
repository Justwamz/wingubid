-- Maker-checker withdrawal approval + email notification config.

-- New withdrawal states: awaiting_approval (held for a risk admin) and rejected.
ALTER TABLE payment_transactions DROP CONSTRAINT IF EXISTS payment_transactions_status_check;
ALTER TABLE payment_transactions ADD CONSTRAINT payment_transactions_status_check
  CHECK (status IN ('pending','awaiting_callback','completed','failed','awaiting_approval','rejected'));

-- Configurable maker-checker threshold in cents (default KES 1,000). Above this,
-- a withdrawal needs a second (admin) approval before payout.
INSERT INTO game_settings (key, value) VALUES ('withdrawal_approval_threshold', '100000')
  ON CONFLICT (key) DO NOTHING;

-- Email notification config (singleton), mirrors sms_configs. toEmail is the
-- fixed internal recipient for withdrawal alerts.
CREATE TABLE email_configs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enabled    BOOLEAN     NOT NULL DEFAULT false,
  config     JSONB       NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO email_configs (enabled, config)
  VALUES (false, '{"provider":"resend","apiKey":"","fromEmail":"","toEmail":"withdrawals@wingubet.com"}');
