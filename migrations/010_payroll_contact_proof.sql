-- Additive only. No activation, contacts, provider configuration or business writes.
ALTER TABLE payroll_telegram_bindings ADD COLUMN telegram_username text;
ALTER TABLE payroll_telegram_bindings ADD COLUMN telegram_full_name text;
ALTER TABLE payroll_telegram_bindings ADD COLUMN claimed_username text CHECK(claimed_username ~ '^[a-z0-9_]{5,32}$');
ALTER TABLE app_users ADD COLUMN email_registration_id text;
ALTER TABLE app_users ADD COLUMN email_registered_at timestamptz;
ALTER TABLE app_users ADD COLUMN email_registration_source text CHECK(email_registration_source IS NULL OR email_registration_source='authenticated_self_registration');
ALTER TABLE payroll_delivery_outbox ADD COLUMN recipient_binding_key text;
-- Canonical uniqueness includes unverified candidates; preexisting duplicates fail closed.
CREATE UNIQUE INDEX payroll_email_contact_unique ON app_users(lower(btrim(email))) WHERE email IS NOT NULL;
CREATE TABLE payroll_email_bindings (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES app_users(id),
 email text NOT NULL CHECK(email=lower(btrim(email)) AND length(email)<=254),
 token_hash text UNIQUE NOT NULL CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz NOT NULL, consumed_at timestamptz,
 status text NOT NULL CHECK(status IN ('issued','pending','verified','revoked')),
 reviewed_by text REFERENCES app_users(id), reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(status NOT IN ('pending','verified') OR consumed_at IS NOT NULL),
 CHECK(status<>'verified' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE UNIQUE INDEX payroll_email_live_user_unique ON payroll_email_bindings(user_id) WHERE status IN ('issued','pending');
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sipeka_runtime') THEN
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I.payroll_email_bindings TO sipeka_runtime',current_schema());
  EXECUTE format('GRANT UPDATE(email,email_verified,email_registration_id,email_registered_at,email_registration_source) ON %I.app_users TO sipeka_runtime',current_schema());
 END IF;
END $$;
