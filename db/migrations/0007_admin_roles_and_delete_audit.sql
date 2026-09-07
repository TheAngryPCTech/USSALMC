-- 0007_admin_roles_and_delete_audit.sql — admin roles + WP SSO email match,
-- and a tiered entity delete workflow with an audit trail.

-- Role tier: 'admin' (default, needs type-to-confirm on hard delete) vs
-- 'super_admin' (single-confirmation hard delete). Existing rows default to
-- 'admin'; the bootstrap account is promoted separately by admin-auth.ts.
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'admin'
  CHECK (role IN ('admin', 'super_admin'));

-- Email used to match a WordPress user for SSO handoff. Nullable (not every
-- admin account needs SSO), unique when set so one WP identity maps to
-- exactly one admin account.
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS email TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users (email) WHERE email IS NOT NULL;

-- Snapshot of an entity at the moment it was soft-deleted, restored, or hard-
-- deleted — so "removed" and "hard-deleted" are never silent/unrecoverable-
-- without-a-trace. Kept even after a hard delete (entity_id has no FK on
-- purpose: the row it refers to may no longer exist).
CREATE TABLE IF NOT EXISTS entity_audit_log (
  id           BIGSERIAL PRIMARY KEY,
  entity_id    TEXT NOT NULL,
  action       TEXT NOT NULL CHECK (action IN ('soft_delete', 'restore', 'hard_delete')),
  snapshot     JSONB NOT NULL,       -- full entity row at the time of the action
  performed_by TEXT,                 -- admin_users.username
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_entity_audit_log_entity ON entity_audit_log (entity_id);
