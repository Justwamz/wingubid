CREATE TABLE admin_audit_log (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id  UUID NOT NULL REFERENCES admin_users(id),
  action    VARCHAR(100) NOT NULL,
  entity    VARCHAR(100) NOT NULL,
  entity_id VARCHAR(255),
  before    JSONB,
  after     JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_admin_audit_log_admin_id ON admin_audit_log(admin_id);
CREATE INDEX idx_admin_audit_log_entity ON admin_audit_log(entity, entity_id);
CREATE INDEX idx_admin_audit_log_created_at ON admin_audit_log(created_at);

CREATE TABLE admin_refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id   UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
