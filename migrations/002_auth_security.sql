-- Authentication hardening. Never changes any existing password hash.
ALTER TABLE app_users ADD COLUMN password_change_required boolean NOT NULL DEFAULT false;
UPDATE app_users SET password_change_required=true WHERE role='OWNER';
ALTER TABLE app_users ADD COLUMN totp_cipher text;
ALTER TABLE app_users ADD COLUMN totp_pending_cipher text;
ALTER TABLE app_users ADD COLUMN totp_pending_until timestamp without time zone;
ALTER TABLE app_users ADD COLUMN totp_last_counter bigint NOT NULL DEFAULT -1;
ALTER TABLE app_users ADD COLUMN recovery_hashes text NOT NULL DEFAULT '[]';
ALTER TABLE sessions ADD COLUMN last_seen_at timestamp without time zone NOT NULL DEFAULT (clock_timestamp() AT TIME ZONE 'UTC');
ALTER TABLE sessions ADD COLUMN purpose text NOT NULL DEFAULT 'full' CHECK (purpose IN ('full','setup','mfa'));
-- Old bearer sessions must not bypass newly required password/2FA gates.
DELETE FROM sessions;
