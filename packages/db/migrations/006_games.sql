CREATE TABLE game_rounds (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_number     BIGSERIAL UNIQUE,
  server_seed_hash VARCHAR(255) NOT NULL,
  server_seed      VARCHAR(255),
  client_seed      VARCHAR(255) NOT NULL,
  crash_point      NUMERIC(10,2),
  status           VARCHAR(20) NOT NULL DEFAULT 'waiting'
                   CHECK (status IN ('waiting','running','crashed')),
  started_at       TIMESTAMPTZ,
  crashed_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_game_rounds_status ON game_rounds(status);

CREATE TABLE bets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id         UUID NOT NULL REFERENCES players(id),
  wallet_id         UUID NOT NULL REFERENCES wallets(id),
  round_id          UUID REFERENCES game_rounds(id),
  game_type         VARCHAR(20) NOT NULL
                    CHECK (game_type IN ('crash','slot','virtual_sport')),
  gross_stake       BIGINT       NOT NULL CHECK (gross_stake > 0),
  wager_tax         BIGINT       NOT NULL DEFAULT 0 CHECK (wager_tax >= 0),
  effective_stake   BIGINT       NOT NULL CHECK (effective_stake > 0),
  auto_cashout_at   NUMERIC(10,2),
  cashout_multiplier NUMERIC(10,2),
  winnings          BIGINT,
  status            VARCHAR(20)  NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','won','lost','refunded')),
  settled_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bets_player_id ON bets(player_id);
CREATE INDEX idx_bets_round_id ON bets(round_id) WHERE round_id IS NOT NULL;
CREATE INDEX idx_bets_status ON bets(status);

CREATE TABLE bonus_grants (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id            UUID   NOT NULL REFERENCES players(id),
  wallet_id            UUID   NOT NULL REFERENCES wallets(id),
  bonus_amount         BIGINT NOT NULL CHECK (bonus_amount > 0),
  wagering_requirement BIGINT NOT NULL CHECK (wagering_requirement > 0),
  wagered_so_far       BIGINT NOT NULL DEFAULT 0,
  status               VARCHAR(20) NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','completed','expired')),
  expires_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bonus_grants_player_id ON bonus_grants(player_id);
