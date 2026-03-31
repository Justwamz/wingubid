CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE players (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone        VARCHAR(20)  UNIQUE NOT NULL,
  name         VARCHAR(255) NOT NULL,
  country      CHAR(2)      NOT NULL,
  currency     CHAR(3)      NOT NULL,
  date_of_birth DATE        NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  status       VARCHAR(20)  NOT NULL DEFAULT 'active'
               CHECK (status IN ('active','suspended','self_excluded')),
  self_excluded_until TIMESTAMPTZ,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_players_phone ON players(phone);
CREATE INDEX idx_players_country ON players(country);
