-- SiPeKA payroll: ciphertext only. No seeded payroll or contacts.
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS telegram_user_id text;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS telegram_verified boolean NOT NULL DEFAULT false;
CREATE TABLE payroll_batches (
 id text PRIMARY KEY, period text NOT NULL CHECK(period ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
 status text NOT NULL CHECK(status IN ('DRAFT','PUBLISHED')), created_by text NOT NULL REFERENCES app_users(id),
 preview_token text NOT NULL, published_by text REFERENCES app_users(id), published_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK ((status='DRAFT' AND published_by IS NULL AND published_at IS NULL) OR (status='PUBLISHED' AND published_by IS NOT NULL AND published_at IS NOT NULL)),
 UNIQUE(id,period)
);
CREATE TABLE payroll_entries (
 id text PRIMARY KEY, batch_id text NOT NULL, period text NOT NULL,
 user_id text NOT NULL REFERENCES app_users(id), payload_cipher text NOT NULL CHECK(payload_cipher LIKE 'v1.%'),
 FOREIGN KEY(batch_id,period) REFERENCES payroll_batches(id,period), UNIQUE(period,user_id)
);
CREATE TABLE payroll_delivery_outbox (
 id text PRIMARY KEY, entry_id text NOT NULL REFERENCES payroll_entries(id),
 channel text NOT NULL CHECK(channel IN ('email','telegram')),
 status text NOT NULL CHECK(status IN ('pending','processing','sending','sent','blocked','failed','uncertain')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0), error_code text, provider_id text,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(entry_id,channel)
);
CREATE INDEX payroll_delivery_pending ON payroll_delivery_outbox(status,updated_at);
CREATE TABLE payroll_access_audit (
 id text PRIMARY KEY, actor_id text REFERENCES app_users(id), action text NOT NULL,
 batch_id text REFERENCES payroll_batches(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER payroll_entries_immutable BEFORE UPDATE OR DELETE ON payroll_entries FOR EACH ROW EXECUTE FUNCTION sipeka_immutable_guard();
CREATE TRIGGER payroll_audit_immutable BEFORE UPDATE OR DELETE ON payroll_access_audit FOR EACH ROW EXECUTE FUNCTION sipeka_immutable_guard();
CREATE FUNCTION sipeka_payroll_batch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.status='PUBLISHED' THEN RAISE EXCEPTION 'PAYROLL_FINAL_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF (to_jsonb(OLD)-'status'-'published_by'-'published_at') IS DISTINCT FROM (to_jsonb(NEW)-'status'-'published_by'-'published_at') OR NEW.status<>'PUBLISHED' THEN RAISE EXCEPTION 'PAYROLL_DRAFT_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER payroll_batch_guard BEFORE UPDATE OR DELETE ON payroll_batches FOR EACH ROW EXECUTE FUNCTION sipeka_payroll_batch_guard();
