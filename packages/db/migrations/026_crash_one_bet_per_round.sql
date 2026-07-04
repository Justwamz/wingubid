-- M5: one crash bet per player per round. Prevents a double bet:place race from
-- debiting twice and orphaning a stake — the second concurrent INSERT hits this
-- unique index, its transaction rolls back (undoing its debit), and the socket
-- returns BET_ALREADY_PLACED.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bets_crash_one_per_round
  ON bets (player_id, round_id)
  WHERE game_type = 'crash' AND round_id IS NOT NULL;
