-- Set the minimum withdrawal for Kenya to KES 100 (10000 cents).
-- country_settings.min_withdrawal was seeded at the column default of 0, so the
-- real withdrawal path (payment.service.initiateWithdrawal) enforced no minimum.
-- This aligns it with the KES 100 minimum already applied client-side and in the
-- demo withdrawal path.
UPDATE country_settings
SET min_withdrawal = 10000,
    updated_at = NOW()
WHERE country = 'KE';
