-- Roles + fine-grained permissions (RBAC) for admin staff.

CREATE TABLE IF NOT EXISTS roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         VARCHAR(40) UNIQUE NOT NULL,
  name        VARCHAR(80) NOT NULL,
  description VARCHAR(255),
  is_system   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id        UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key VARCHAR(60) NOT NULL,
  PRIMARY KEY (role_id, permission_key)
);

-- The role column was a fixed 4-value enum; drop that CHECK so it can hold any
-- role key (custom roles included). It stays as a denormalized cache of the
-- assigned role's key, kept in sync by the app on assignment.
ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS admin_users_role_check;

ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES roles(id),
  ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(10) NOT NULL DEFAULT 'local'
    CHECK (auth_provider IN ('local','ldap')),
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES admin_users(id),
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- Seed roles (idempotent). super_admin is all-access in code; no rows needed
-- for it in role_permissions. 'reports' kept for back-compat with any legacy
-- admin_users.role = 'reports'.
INSERT INTO roles (key, name, description, is_system) VALUES
  ('super_admin', 'Super Admin', 'Full access to everything.', true),
  ('finance',     'Finance',     'Money operations.',          true),
  ('risk',        'Risk',        'Game integrity and abuse.',  true),
  ('support',     'Support',     'Customer support.',          true),
  ('reports',     'Reports',     'Read-only reporting.',       true)
ON CONFLICT (key) DO NOTHING;

-- Minimal default grants: each role gets stats.view + its own area's view.
-- Super admin configures the rest in the UI.
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.key FROM roles r
JOIN (VALUES
  ('finance','stats.view'), ('finance','withdrawals.view'), ('finance','transactions.view'),
  ('risk','stats.view'),    ('risk','settings.view'),       ('risk','chat.view'),
  ('support','stats.view'), ('support','players.view'),     ('support','chat.view'),
  ('reports','stats.view')
) AS p(role_key, key) ON p.role_key = r.key
ON CONFLICT (role_id, permission_key) DO NOTHING;

-- Backfill role_id from the existing denormalized role key.
UPDATE admin_users au
SET role_id = r.id
FROM roles r
WHERE r.key = au.role AND au.role_id IS NULL;
