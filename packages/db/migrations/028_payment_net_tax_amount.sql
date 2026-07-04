-- L3: give withdrawals dedicated net_amount / tax_amount columns instead of
-- overloading failure_reason with JSON (fragile, and collides with real failure
-- messages). Nullable; only withdrawals populate them.
ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS net_amount BIGINT;
ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS tax_amount BIGINT;
