-- Additive schema and schema-local least-privilege runtime ACL; no provider activation.
-- No users, contacts or provider configuration seeded. Existing duplicate contacts fail closed.
-- Onboarding uses pg_advisory_xact_lock(1397313611,9), not LOCK TABLE.
-- Runtime requires SELECT app_users, UPDATE(telegram_user_id,telegram_verified)
-- app_users, SELECT/INSERT/UPDATE payroll_telegram_bindings, INSERT
-- payroll_access_audit, schema USAGE, and EXECUTE pg_catalog.pg_advisory_xact_lock(integer,integer).
-- Never grant table-wide app_users UPDATE for onboarding. Apply reviewed ACLs
-- schema-locally to the established sipeka_runtime role only, when provisioned.
CREATE UNIQUE INDEX payroll_telegram_contact_unique ON app_users(telegram_user_id) WHERE telegram_user_id IS NOT NULL;
CREATE TABLE payroll_telegram_bindings (
 id text PRIMARY KEY,
 user_id text NOT NULL REFERENCES app_users(id),
 issued_by text NOT NULL REFERENCES app_users(id),
 token_hash text UNIQUE NOT NULL CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 chat_id text CHECK(chat_id ~ '^[1-9][0-9]{0,15}$'),
 status text NOT NULL CHECK(status IN ('issued','pending','verified','revoked')),
 reviewed_by text REFERENCES app_users(id), reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK ((status='issued' AND consumed_at IS NULL AND chat_id IS NULL) OR status='revoked' OR (status IN ('pending','verified') AND consumed_at IS NOT NULL AND chat_id IS NOT NULL)),
 CHECK(status<>'verified' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE UNIQUE INDEX payroll_telegram_pending_chat_unique ON payroll_telegram_bindings(chat_id) WHERE status='pending';
CREATE UNIQUE INDEX payroll_telegram_live_user_unique ON payroll_telegram_bindings(user_id) WHERE status IN ('issued','pending');
DO $$
DECLARE target_schema text := current_schema();
BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sipeka_runtime') THEN
  EXECUTE format('GRANT UPDATE (telegram_user_id,telegram_verified) ON TABLE %I.app_users TO sipeka_runtime',target_schema);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON TABLE %I.payroll_telegram_bindings TO sipeka_runtime',target_schema);
 END IF;
END $$;
