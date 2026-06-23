-- Add Crash as a third-party provider game slot
INSERT INTO game_slots (name, slug) VALUES
  ('Crash', 'crash')
ON CONFLICT (slug) DO NOTHING;
