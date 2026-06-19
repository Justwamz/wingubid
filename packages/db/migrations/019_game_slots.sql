-- Game slots registry — source of truth for which games exist on the platform
CREATE TABLE IF NOT EXISTS game_slots (
  id        UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name      VARCHAR(100) NOT NULL,
  slug      VARCHAR(50)  NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO game_slots (name, slug) VALUES
  ('Aviator',       'aviator'),
  ('Aviatrix',      'aviatrix'),
  ('JetX',          'jetx'),
  ('B-Ball Blitz',  'bball-blitz'),
  ('Sun of Egypt 4','sun-of-egypt-4')
ON CONFLICT (slug) DO NOTHING;
