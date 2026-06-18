CREATE TABLE lottery_draws (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draw_type       VARCHAR(10) NOT NULL CHECK (draw_type IN ('hourly','daily','weekly')),
  ticket_price    BIGINT NOT NULL,
  scheduled_at    TIMESTAMPTZ NOT NULL,
  drawn_at        TIMESTAMPTZ,
  winning_numbers INT[],
  status          VARCHAR(10) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','completed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_lottery_draws_type_status ON lottery_draws(draw_type, status);
CREATE INDEX idx_lottery_draws_scheduled_at ON lottery_draws(scheduled_at);

CREATE TABLE lottery_tickets (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id      UUID NOT NULL REFERENCES players(id),
  wallet_id      UUID NOT NULL REFERENCES wallets(id),
  draw_id        UUID NOT NULL REFERENCES lottery_draws(id),
  picked_numbers INT[] NOT NULL,
  ticket_price   BIGINT NOT NULL,
  matched_count  INT,
  prize_cents    BIGINT NOT NULL DEFAULT 0,
  status         VARCHAR(10) NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','won','lost')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_lottery_tickets_player_id ON lottery_tickets(player_id);
CREATE INDEX idx_lottery_tickets_draw_id ON lottery_tickets(draw_id);

CREATE TABLE scratch_cards (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   UUID NOT NULL REFERENCES players(id),
  wallet_id   UUID NOT NULL REFERENCES wallets(id),
  stake_cents BIGINT NOT NULL,
  grid        INT[] NOT NULL,
  prize_cents BIGINT NOT NULL DEFAULT 0,
  status      VARCHAR(10) NOT NULL DEFAULT 'completed',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_scratch_cards_player_id ON scratch_cards(player_id);

CREATE TABLE banners (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  placement VARCHAR(10)  NOT NULL CHECK (placement IN ('landing','lobby')),
  headline  VARCHAR(80)  NOT NULL,
  subtext   VARCHAR(160) NOT NULL DEFAULT '',
  cta_text  VARCHAR(40)  NOT NULL DEFAULT '',
  cta_url   VARCHAR(255) NOT NULL DEFAULT '/wallet/deposit',
  image_url VARCHAR(500) NOT NULL DEFAULT '',
  gradient  VARCHAR(100) NOT NULL DEFAULT 'from-cyan-900/60 to-violet-900/40',
  active    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_banners_placement_active ON banners(placement, active);

-- Seed demo banners
INSERT INTO banners (placement, headline, subtext, cta_text, cta_url, gradient, active) VALUES
(
  'landing',
  '🎉 Register Free. Start with KES 10,000',
  'No deposit needed. Create your account and play Crash, Mines, Dice, Lotto and Scratch instantly.',
  'Create Free Account',
  '/register',
  'from-cyan-900/60 to-violet-900/40',
  true
),
(
  'lobby',
  '💰 Deposit and Play. Double Your First Top-Up',
  'Add KES 500 or more and we match it. Play Crash, Mines, Dice, Lotto and Scratch.',
  'Top Up Now',
  '/wallet/deposit',
  'from-violet-900/60 to-cyan-900/40',
  true
);
