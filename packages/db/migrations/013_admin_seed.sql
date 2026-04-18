-- Seed initial super-admin account (safe to re-run)
INSERT INTO admin_users (name, email, password_hash, role, status)
VALUES ('Super Admin', 'admin@wingubid.com', '$2b$10$dLovYyvorm4XdXHPnoH4..YSYT3AsVtPzBiizrMT.RZNk8caLWxFm', 'super_admin', 'active')
ON CONFLICT (email) DO NOTHING;
