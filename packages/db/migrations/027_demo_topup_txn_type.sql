-- M6: give demo top-ups a distinct ledger type so every balance change is
-- traceable to a transactions row, without polluting the real-deposit metric
-- (admin stats sum type='deposit'; admin transactions list already excludes
-- 'demo_topup').
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_type_check
  CHECK (type IN (
    'deposit','withdrawal','bet_placed','bet_won','bet_refunded',
    'bonus_credit','bonus_wager','wager_tax','withdrawal_tax','demo_topup'
  ));
