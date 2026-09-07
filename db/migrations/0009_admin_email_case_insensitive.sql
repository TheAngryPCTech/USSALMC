-- 0009_admin_email_case_insensitive.sql — email matching for SSO must never be
-- case-sensitive (WordPress/mail providers treat email case-insensitively).
-- Bug found live: a WP user's email (`Bash@Angrypctech.com`) didn't match the
-- stored admin_users row (`bash@angrypctech.com`) because the original unique
-- index + lookup query both compared raw TEXT. Normalize existing data and
-- replace the index with one on lower(email) so a case-differing duplicate
-- can never be inserted again.

UPDATE admin_users SET email = lower(email) WHERE email IS NOT NULL;

DROP INDEX IF EXISTS idx_admin_users_email;
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_email_lower ON admin_users (lower(email)) WHERE email IS NOT NULL;
