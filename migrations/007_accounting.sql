-- Maintenance-only migration. No operational backfill, balances or legal/tax assumptions.
CREATE TABLE accounting_accounts (
 id text PRIMARY KEY, code text UNIQUE NOT NULL, name text NOT NULL,
 type text NOT NULL CHECK(type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE'))
);
-- Explicit unconfigured standard definitions; no opening journal or funding identity implied.
INSERT INTO accounting_accounts VALUES
 ('asset_cash','1101','Kas tunai','ASSET'),('asset_bank','1102','Bank','ASSET'),
 ('asset_qris','1103','Piutang clearing QRIS','ASSET'),('asset_ar','1201','Piutang usaha','ASSET'),
 ('asset_inventory','1301','Persediaan','ASSET'),('asset_prepaid','1401','Biaya dibayar dimuka','ASSET'),
 ('asset_fixed','1501','Aset tetap','ASSET'),('asset_depreciation','1591','Akumulasi penyusutan','ASSET'),
 ('liability_ap','2101','Utang usaha','LIABILITY'),('liability_advance','2201','Pendapatan diterima dimuka','LIABILITY'),
 ('liability_loan','2301','Pinjaman','LIABILITY'),('equity_capital','3101','Modal','EQUITY'),
 ('equity_retained','3201','Saldo laba','EQUITY');
CREATE TABLE accounting_category_maps(coa_id text PRIMARY KEY REFERENCES chart_of_accounts(id),account_id text NOT NULL REFERENCES accounting_accounts(id));
CREATE TABLE accounting_funds(id text PRIMARY KEY,branch_id text NOT NULL REFERENCES business_units(id),
 method text NOT NULL CHECK(method IN ('CASH_DRAWER','BANK_TRANSFER','QRIS')),account_id text NOT NULL REFERENCES accounting_accounts(id),evidence text NOT NULL CHECK(length(evidence)>=10));
CREATE TABLE accounting_period_locks(month date PRIMARY KEY CHECK(extract(day FROM month)=1),actor_id text NOT NULL REFERENCES app_users(id),reason text NOT NULL);
CREATE TABLE accounting_journals(id text PRIMARY KEY,idempotency_key text UNIQUE NOT NULL,request jsonb NOT NULL,
 source_type text NOT NULL CHECK(source_type IN ('CASH_TRANSACTION','REVERSAL')),source_id text NOT NULL,
 source_basis text NOT NULL CHECK(source_basis IN ('RECORDED_CASH_BASIS','REVERSAL_RECORDED_CASH_BASIS')),
 accounting_date date NOT NULL,actor_id text NOT NULL REFERENCES app_users(id),approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 source_snapshot jsonb NOT NULL,UNIQUE(source_type,source_id));
CREATE TABLE accounting_lines(journal_id text NOT NULL REFERENCES accounting_journals(id),line_no integer NOT NULL,
 account_id text NOT NULL REFERENCES accounting_accounts(id),branch_id text NOT NULL REFERENCES business_units(id),
 debit bigint NOT NULL CHECK(debit>=0),credit bigint NOT NULL CHECK(credit>=0),
 CHECK((debit>0 AND credit=0) OR (credit>0 AND debit=0)),PRIMARY KEY(journal_id,line_no));
CREATE INDEX accounting_date_idx ON accounting_journals(accounting_date);
CREATE INDEX accounting_branch_idx ON accounting_lines(branch_id,journal_id);
CREATE FUNCTION accounting_balance_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE jid text; n bigint; d numeric; c numeric;
BEGIN
 IF TG_TABLE_NAME='accounting_journals' THEN jid:=NEW.id; ELSE jid:=NEW.journal_id; END IF;
 SELECT count(*),sum(debit::numeric),sum(credit::numeric) INTO n,d,c FROM accounting_lines WHERE journal_id=jid;
 IF n<2 OR d<>c THEN RAISE EXCEPTION 'UNBALANCED_JOURNAL' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER accounting_header_balanced AFTER INSERT ON accounting_journals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION accounting_balance_guard();
CREATE CONSTRAINT TRIGGER accounting_lines_balanced AFTER INSERT ON accounting_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION accounting_balance_guard();
CREATE TRIGGER accounting_header_immutable BEFORE UPDATE OR DELETE ON accounting_journals FOR EACH ROW EXECUTE FUNCTION sipeka_immutable_guard();
CREATE TRIGGER accounting_lines_immutable BEFORE UPDATE OR DELETE ON accounting_lines FOR EACH ROW EXECUTE FUNCTION sipeka_immutable_guard();
CREATE TRIGGER accounting_accounts_immutable BEFORE UPDATE OR DELETE ON accounting_accounts FOR EACH ROW EXECUTE FUNCTION sipeka_immutable_guard();
CREATE TRIGGER accounting_maps_immutable BEFORE UPDATE OR DELETE ON accounting_category_maps FOR EACH ROW EXECUTE FUNCTION sipeka_immutable_guard();
CREATE TRIGGER accounting_funds_immutable BEFORE UPDATE OR DELETE ON accounting_funds FOR EACH ROW EXECUTE FUNCTION sipeka_immutable_guard();
CREATE FUNCTION accounting_owner(token_value text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor text;
BEGIN
 SELECT u.id INTO actor FROM sessions s JOIN app_users u ON u.id=s.user_id
 WHERE s.token=token_value AND s.expired_at>(clock_timestamp() AT TIME ZONE 'UTC') AND s.purpose='full' AND u.role='OWNER';
 IF actor IS NULL THEN RAISE EXCEPTION 'OWNER_REQUIRED' USING ERRCODE='42501'; END IF;
 RETURN actor;
END $$;
CREATE FUNCTION accounting_post(token_value text,p jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor text; j text; prior accounting_journals%ROWTYPE; tx ledger_transactions%ROWTYPE;
 fund accounting_funds%ROWTYPE; category text; date_value date; orig accounting_journals%ROWTYPE;
BEGIN
 actor:=accounting_owner(token_value);
 IF jsonb_typeof(p)<>'object' OR length(coalesce(p->>'idempotencyKey','')) NOT BETWEEN 1 AND 128 OR length(coalesce(p->>'evidence','')) NOT BETWEEN 10 AND 2000 THEN RAISE EXCEPTION 'APPROVAL_EVIDENCE_REQUIRED'; END IF;
 IF coalesce(p->>'accountingDate','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'ACCOUNTING_DATE_REQUIRED'; END IF;
 date_value:=(p->>'accountingDate')::date;
 -- Posting and maintenance period close must acquire the same transaction lock.
 PERFORM pg_advisory_xact_lock(1397313612::bigint);
 SELECT * INTO prior FROM accounting_journals WHERE idempotency_key=p->>'idempotencyKey';
 IF FOUND THEN
  IF prior.request<>p OR prior.actor_id<>actor THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
  RETURN prior.id;
 END IF;
 IF EXISTS(SELECT 1 FROM accounting_period_locks WHERE month=date_trunc('month',date_value)::date) THEN RAISE EXCEPTION 'ACCOUNTING_PERIOD_LOCKED'; END IF;
 j:=md5(clock_timestamp()::text||random()::text||actor);
 IF p->>'sourceType'='CASH_TRANSACTION' THEN
  SELECT * INTO tx FROM ledger_transactions WHERE id=p->>'sourceId';
  IF NOT FOUND OR tx.status<>'APPROVED' OR tx.tx_intent IS DISTINCT FROM 'SETOR_NOTA' THEN RAISE EXCEPTION 'APPROVED_REALIZED_SOURCE_REQUIRED'; END IF;
  SELECT * INTO fund FROM accounting_funds WHERE id=p->>'fundId' AND branch_id=tx.branch_id AND method=tx.payment_method;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM accounting_accounts WHERE id=fund.account_id AND type='ASSET') THEN RAISE EXCEPTION 'NAMED_FUND_REQUIRED'; END IF;
  IF tx.payment_method='QRIS' AND tx.tx_type<>'INCOME' THEN RAISE EXCEPTION 'QRIS_OUTFLOW_UNSUPPORTED'; END IF;
  IF tx.payment_method='QRIS' AND NOT EXISTS(SELECT 1 FROM accounting_accounts WHERE id=fund.account_id AND code='1103') THEN RAISE EXCEPTION 'QRIS_CLEARING_REQUIRED'; END IF;
  SELECT m.account_id INTO category FROM accounting_category_maps m JOIN accounting_accounts a ON a.id=m.account_id JOIN chart_of_accounts c ON c.id=m.coa_id
  WHERE m.coa_id=tx.coa_id AND a.type=CASE WHEN tx.tx_type='INCOME' THEN 'REVENUE' ELSE 'EXPENSE' END AND c.account_type=a.type;
  IF category IS NULL THEN RAISE EXCEPTION 'REVIEWED_CATEGORY_REQUIRED'; END IF;
  INSERT INTO accounting_journals VALUES(j,p->>'idempotencyKey',p,'CASH_TRANSACTION',tx.id,'RECORDED_CASH_BASIS',date_value,actor,clock_timestamp(),jsonb_build_object('transaction',to_jsonb(tx)-'memo'-'receipt_key','fund',to_jsonb(fund),'category',category,'limitations','No accrual or tax inference; QRIS clearing not settled bank cash'));
  INSERT INTO accounting_lines VALUES(j,1,fund.account_id,tx.branch_id,CASE WHEN tx.tx_type='INCOME' THEN tx.amount ELSE 0 END,CASE WHEN tx.tx_type='EXPENSE' THEN tx.amount ELSE 0 END),
  (j,2,category,tx.branch_id,CASE WHEN tx.tx_type='EXPENSE' THEN tx.amount ELSE 0 END,CASE WHEN tx.tx_type='INCOME' THEN tx.amount ELSE 0 END);
 ELSIF p->>'sourceType'='REVERSAL' THEN
  SELECT * INTO orig FROM accounting_journals WHERE id=p->>'sourceId' AND source_type='CASH_TRANSACTION';
  IF NOT FOUND THEN RAISE EXCEPTION 'REVERSAL_ORIGINAL_REQUIRED'; END IF;
  IF date_value<orig.accounting_date THEN RAISE EXCEPTION 'REVERSAL_DATE_BEFORE_ORIGINAL'; END IF;
  INSERT INTO accounting_journals VALUES(j,p->>'idempotencyKey',p,'REVERSAL',orig.id,'REVERSAL_RECORDED_CASH_BASIS',date_value,actor,clock_timestamp(),jsonb_build_object('originalJournalId',orig.id));
  INSERT INTO accounting_lines SELECT j,line_no,account_id,branch_id,credit,debit FROM accounting_lines WHERE journal_id=orig.id;
 ELSE RAISE EXCEPTION 'SOURCE_TYPE_UNSUPPORTED'; END IF;
 RETURN j;
END $$;
-- Read-only review, same mapping restrictions as posting; never inserts a journal.
CREATE FUNCTION accounting_preview(token_value text,p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE tx ledger_transactions%ROWTYPE; fund accounting_funds%ROWTYPE; category accounting_accounts%ROWTYPE; orig accounting_journals%ROWTYPE;
BEGIN
 PERFORM accounting_owner(token_value);
 IF EXISTS(SELECT 1 FROM accounting_period_locks WHERE month=date_trunc('month',(p->>'accountingDate')::date)::date) THEN RAISE EXCEPTION 'ACCOUNTING_PERIOD_LOCKED'; END IF;
 IF p->>'sourceType'='REVERSAL' THEN
  SELECT * INTO orig FROM accounting_journals WHERE id=p->>'sourceId' AND source_type='CASH_TRANSACTION';
  IF NOT FOUND THEN RAISE EXCEPTION 'REVERSAL_ORIGINAL_REQUIRED'; END IF;
  IF (p->>'accountingDate')::date<orig.accounting_date THEN RAISE EXCEPTION 'REVERSAL_DATE_BEFORE_ORIGINAL'; END IF;
  RETURN jsonb_build_object('id',orig.id,'accounting_date',orig.accounting_date,'source_type',orig.source_type,'source_id',orig.source_id);
 END IF;
 SELECT * INTO tx FROM ledger_transactions WHERE id=p->>'sourceId';
 IF NOT FOUND OR tx.status<>'APPROVED' OR tx.tx_intent IS DISTINCT FROM 'SETOR_NOTA' THEN RAISE EXCEPTION 'APPROVED_REALIZED_SOURCE_REQUIRED'; END IF;
 SELECT * INTO fund FROM accounting_funds WHERE id=p->>'fundId' AND branch_id=tx.branch_id AND method=tx.payment_method;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM accounting_accounts WHERE id=fund.account_id AND type='ASSET') THEN RAISE EXCEPTION 'NAMED_FUND_REQUIRED'; END IF;
 IF tx.payment_method='QRIS' AND tx.tx_type<>'INCOME' THEN RAISE EXCEPTION 'QRIS_OUTFLOW_UNSUPPORTED'; END IF;
 IF tx.payment_method='QRIS' AND NOT EXISTS(SELECT 1 FROM accounting_accounts WHERE id=fund.account_id AND code='1103') THEN RAISE EXCEPTION 'QRIS_CLEARING_REQUIRED'; END IF;
 SELECT a.* INTO category FROM accounting_category_maps m JOIN accounting_accounts a ON a.id=m.account_id JOIN chart_of_accounts c ON c.id=m.coa_id
 WHERE m.coa_id=tx.coa_id AND a.type=CASE WHEN tx.tx_type='INCOME' THEN 'REVENUE' ELSE 'EXPENSE' END AND c.account_type=a.type;
 IF NOT FOUND THEN RAISE EXCEPTION 'REVIEWED_CATEGORY_REQUIRED'; END IF;
 RETURN jsonb_build_object('id',tx.id,'branch_id',tx.branch_id,'coa_id',tx.coa_id,'tx_type',tx.tx_type,'amount',tx.amount::text,'payment_method',tx.payment_method,'status',tx.status,'tx_intent',tx.tx_intent,'fund',to_jsonb(fund),'fundAccount',(SELECT to_jsonb(a) FROM accounting_accounts a WHERE id=fund.account_id),'category',to_jsonb(category));
END $$;
REVOKE ALL ON FUNCTION accounting_owner(text),accounting_post(text,jsonb),accounting_preview(text,jsonb) FROM PUBLIC;
DO $$
DECLARE s text:=current_schema();
BEGIN
 EXECUTE format('ALTER FUNCTION %I.accounting_owner(text) SET search_path = %I, pg_temp',s,s);
 EXECUTE format('ALTER FUNCTION %I.accounting_post(text,jsonb) SET search_path = %I, pg_temp',s,s);
 EXECUTE format('ALTER FUNCTION %I.accounting_preview(text,jsonb) SET search_path = %I, pg_temp',s,s);
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sipeka_runtime') THEN
  EXECUTE format('GRANT SELECT ON %I.accounting_accounts,%I.accounting_journals,%I.accounting_lines,%I.accounting_period_locks TO sipeka_runtime',s,s,s,s);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %I.accounting_owner(text),%I.accounting_post(text,jsonb),%I.accounting_preview(text,jsonb) TO sipeka_runtime',s,s,s);
 END IF;
END $$;
