-- Paybill (C2B) payments made directly to the deposit shortcode. Each payment is
-- recorded here (matched or not); unmatched ones are held for manual admin
-- reconciliation (repost to a user or refund). mpesa_receipt is unique so a
-- re-sent confirmation never double-credits.
CREATE TABLE c2b_payments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  msisdn        VARCHAR(20)  NOT NULL,
  amount        BIGINT       NOT NULL,
  mpesa_receipt VARCHAR(64)  UNIQUE NOT NULL,
  status        VARCHAR(20)  NOT NULL CHECK (status IN ('credited','unresolved','reposted','refunded')),
  player_id     UUID         REFERENCES players(id),
  resolved_by   UUID         REFERENCES admin_users(id),
  resolved_at   TIMESTAMPTZ,
  note          TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_c2b_payments_status ON c2b_payments(status);
CREATE INDEX idx_c2b_payments_created_at ON c2b_payments(created_at DESC);
