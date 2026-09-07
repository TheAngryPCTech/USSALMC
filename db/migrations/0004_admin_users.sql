-- 0004_admin_users.sql — DB-backed admin login (replaces static Basic auth).
-- Supports a bootstrap account + "force password change on first login".

CREATE TABLE IF NOT EXISTS admin_users (
  username             TEXT PRIMARY KEY,
  password_hash        TEXT NOT NULL,             -- scrypt: "<salt_hex>:<hash_hex>"
  must_change_password BOOLEAN NOT NULL DEFAULT true,
  is_dev_credential    BOOLEAN NOT NULL DEFAULT false,  -- flags the seeded bootstrap login
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at        TIMESTAMPTZ
);
