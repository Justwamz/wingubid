ALTER TABLE bets
  DROP CONSTRAINT bets_game_type_check,
  ADD CONSTRAINT bets_game_type_check
    CHECK (game_type IN ('crash', 'mines', 'dice', 'slot', 'virtual_sport'));
