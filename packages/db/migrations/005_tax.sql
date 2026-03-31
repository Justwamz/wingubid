CREATE TABLE admin_users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(255) NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(20) NOT NULL
                CHECK (role IN ('super_admin','finance','support','reports')),
  status        VARCHAR(20) NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','suspended')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tax_rules (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country    CHAR(2)       NOT NULL,
  tax_type   VARCHAR(20)   NOT NULL CHECK (tax_type IN ('wager_tax','withdrawal_tax')),
  rate       NUMERIC(5,2)  NOT NULL CHECK (rate >= 0 AND rate <= 100),
  enabled    BOOLEAN       NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_by UUID          REFERENCES admin_users(id),
  UNIQUE(country, tax_type)
);

CREATE TABLE tax_transactions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id      UUID NOT NULL REFERENCES players(id),
  transaction_id UUID NOT NULL REFERENCES transactions(id),
  tax_type       VARCHAR(20) NOT NULL CHECK (tax_type IN ('wager_tax','withdrawal_tax')),
  country        CHAR(2)     NOT NULL,
  amount         BIGINT      NOT NULL CHECK (amount > 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tax_transactions_player_id ON tax_transactions(player_id);
CREATE INDEX idx_tax_transactions_created_at ON tax_transactions(created_at);
CREATE INDEX idx_tax_transactions_country ON tax_transactions(country);

CREATE TABLE ledger_closes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date       DATE    NOT NULL,
  country    CHAR(2) NOT NULL,
  closed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_by  VARCHAR(50) NOT NULL DEFAULT 'system',
  UNIQUE(date, country)
);

CREATE TABLE tax_remittances (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date              DATE        NOT NULL,
  country           CHAR(2)     NOT NULL,
  tax_type          VARCHAR(20) NOT NULL CHECK (tax_type IN ('wager_tax','withdrawal_tax')),
  total_amount      BIGINT      NOT NULL,
  transaction_count INTEGER     NOT NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'pending_approval'
                    CHECK (status IN ('pending_approval','approved','disputed')),
  approved_by       UUID        REFERENCES admin_users(id),
  approved_at       TIMESTAMPTZ,
  disputed_by       UUID        REFERENCES admin_users(id),
  disputed_at       TIMESTAMPTZ,
  dispute_reason    TEXT,
  payment_reference VARCHAR(255),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
