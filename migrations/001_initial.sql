-- SiPeKA operational ledger parity. Explicit migrations only; no seed data.
CREATE TABLE business_units (
 id text PRIMARY KEY, code text UNIQUE NOT NULL, name text UNIQUE NOT NULL, category text NOT NULL,
 is_active integer DEFAULT 1 CHECK (is_active IN (0,1)),
 created_at timestamp(0) without time zone DEFAULT date_trunc('second', clock_timestamp() AT TIME ZONE 'UTC')
);
CREATE TABLE app_users (
 id text PRIMARY KEY, username text UNIQUE NOT NULL, password_hash text NOT NULL, full_name text NOT NULL,
 role text NOT NULL CHECK (role IN ('OWNER','STAFF')), assigned_branch_id text REFERENCES business_units(id),
 created_at timestamp(0) without time zone DEFAULT date_trunc('second', clock_timestamp() AT TIME ZONE 'UTC')
);
CREATE TABLE chart_of_accounts (
 id text PRIMARY KEY, account_code text UNIQUE NOT NULL, account_name text NOT NULL, account_type text NOT NULL
);
CREATE TABLE ledger_transactions (
 id text PRIMARY KEY, idempotency_key text UNIQUE NOT NULL, branch_id text NOT NULL REFERENCES business_units(id),
 user_id text NOT NULL REFERENCES app_users(id), coa_id text NOT NULL REFERENCES chart_of_accounts(id),
 tx_type text NOT NULL CHECK (tx_type IN ('INCOME','EXPENSE')),
 amount bigint NOT NULL CHECK (amount>0 AND amount<=9007199254740991),
 payment_method text NOT NULL CHECK (payment_method IN ('CASH_DRAWER','QRIS','BANK_TRANSFER')),
 memo text, receipt_key text, status text NOT NULL DEFAULT 'APPROVED' CHECK (status IN ('APPROVED','PENDING_APPROVAL','REJECTED')),
 tx_intent text DEFAULT 'SETOR_NOTA' CHECK (tx_intent IN ('SETOR_NOTA','PENGAJUAN_DANA')),
 idempotency_user_id text, idempotency_branch_id text, idempotency_fingerprint text,
 created_at timestamp(0) without time zone DEFAULT date_trunc('second', clock_timestamp() AT TIME ZONE 'UTC')
);
CREATE TABLE approval_logs (
 id text PRIMARY KEY, transaction_id text NOT NULL REFERENCES ledger_transactions(id),
 action text NOT NULL CHECK (action IN ('APPROVED','REJECTED')), reviewer_id text NOT NULL REFERENCES app_users(id), notes text,
 created_at timestamp(0) without time zone DEFAULT date_trunc('second', clock_timestamp() AT TIME ZONE 'UTC')
);
CREATE TABLE cash_closings (
 id text PRIMARY KEY, branch_id text NOT NULL REFERENCES business_units(id), user_id text NOT NULL REFERENCES app_users(id),
 closing_date date NOT NULL DEFAULT (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date,
 system_balance bigint NOT NULL CHECK (system_balance BETWEEN -9007199254740991 AND 9007199254740991),
 physical_cash bigint NOT NULL CHECK (physical_cash BETWEEN 0 AND 9007199254740991),
 difference bigint NOT NULL CHECK (difference BETWEEN -9007199254740991 AND 9007199254740991), reason text,
 total_nota bigint DEFAULT 0 CHECK (total_nota BETWEEN 0 AND 9007199254740991),
 kg_reguler double precision DEFAULT 0 CHECK (kg_reguler>=0 AND kg_reguler<'Infinity'::float8),
 kg_express double precision DEFAULT 0 CHECK (kg_express>=0 AND kg_express<'Infinity'::float8),
 kg_kilat double precision DEFAULT 0 CHECK (kg_kilat>=0 AND kg_kilat<'Infinity'::float8),
 income_cash bigint DEFAULT 0 CHECK (income_cash BETWEEN 0 AND 9007199254740991),
 income_qris bigint DEFAULT 0 CHECK (income_qris BETWEEN 0 AND 9007199254740991),
 income_transfer bigint DEFAULT 0 CHECK (income_transfer BETWEEN 0 AND 9007199254740991),
 stock_detergent double precision DEFAULT 0 CHECK (stock_detergent>=0 AND stock_detergent<'Infinity'::float8),
 stock_perfume double precision DEFAULT 0 CHECK (stock_perfume>=0 AND stock_perfume<'Infinity'::float8),
 operational_notes text, status text NOT NULL DEFAULT 'CLOSED' CHECK (status='CLOSED'), idempotency_key text, fingerprint text,
 created_at timestamp(0) without time zone DEFAULT date_trunc('second', clock_timestamp() AT TIME ZONE 'UTC'),
 CONSTRAINT closing_user_branch_date_unique UNIQUE(user_id,branch_id,closing_date),
 CONSTRAINT closing_difference_correct CHECK (difference::numeric=physical_cash::numeric-system_balance::numeric)
);
CREATE TABLE sessions (
 token text PRIMARY KEY, user_id text NOT NULL REFERENCES app_users(id), expired_at timestamp(0) without time zone NOT NULL,
 created_at timestamp(0) without time zone DEFAULT date_trunc('second', clock_timestamp() AT TIME ZONE 'UTC')
);
CREATE TABLE receipt_assets (
 filename text PRIMARY KEY, user_id text NOT NULL REFERENCES app_users(id), branch_id text REFERENCES business_units(id), mime text NOT NULL,
 created_at timestamp(0) without time zone DEFAULT date_trunc('second', clock_timestamp() AT TIME ZONE 'UTC')
);
CREATE INDEX tx_staff_branch_created ON ledger_transactions(user_id,branch_id,created_at DESC);
CREATE INDEX tx_branch_created ON ledger_transactions(branch_id,created_at DESC);
CREATE INDEX approval_transaction_created ON approval_logs(transaction_id,created_at DESC);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX closings_branch_date ON cash_closings(branch_id,closing_date);

CREATE FUNCTION sipeka_ledger_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'APPEND_ONLY_TRANSAKSI_TERKUNCI' USING ERRCODE='23514'; END IF;
 IF (to_jsonb(OLD)-'status') IS DISTINCT FROM (to_jsonb(NEW)-'status') THEN
  RAISE EXCEPTION 'APPEND_ONLY: data finansial transaksi terkunci' USING ERRCODE='23514';
 END IF;
 IF OLD.status IS DISTINCT FROM NEW.status AND
    (OLD.status<>'PENDING_APPROVAL' OR NEW.status NOT IN ('APPROVED','REJECTED')) THEN
  RAISE EXCEPTION 'APPROVAL_STATUS_FINAL' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sipeka_ledger_update BEFORE UPDATE ON ledger_transactions FOR EACH ROW EXECUTE FUNCTION sipeka_ledger_guard();
CREATE TRIGGER sipeka_ledger_delete BEFORE DELETE ON ledger_transactions FOR EACH ROW EXECUTE FUNCTION sipeka_ledger_guard();
CREATE FUNCTION sipeka_immutable_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'APPEND_ONLY_%_TERKUNCI',TG_TABLE_NAME USING ERRCODE='23514'; END $$;
CREATE TRIGGER sipeka_closing_update BEFORE UPDATE ON cash_closings FOR EACH ROW EXECUTE FUNCTION sipeka_immutable_guard();
CREATE TRIGGER sipeka_closing_delete BEFORE DELETE ON cash_closings FOR EACH ROW EXECUTE FUNCTION sipeka_immutable_guard();
CREATE TRIGGER sipeka_approval_immutable BEFORE UPDATE OR DELETE ON approval_logs FOR EACH ROW EXECUTE FUNCTION sipeka_immutable_guard();
