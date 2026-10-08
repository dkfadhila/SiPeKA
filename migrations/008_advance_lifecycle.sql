-- Explicit lifecycle only. No ledger updates, backfill, journal posting or production seeds.
CREATE TABLE advance_events (
 id text PRIMARY KEY, advance_id text NOT NULL REFERENCES ledger_transactions(id),
 branch_id text NOT NULL REFERENCES business_units(id), actor_id text NOT NULL REFERENCES app_users(id),
 action text NOT NULL CHECK(action IN ('DISBURSE','SUBMIT','APPROVE','REJECT','RETURN')),
 settlement_id text REFERENCES advance_events(id),
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 128),
 request jsonb NOT NULL, result jsonb NOT NULL,
 amount bigint NOT NULL CHECK(amount BETWEEN 0 AND 9007199254740991),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(actor_id,branch_id,action,idempotency_key)
);
CREATE UNIQUE INDEX advance_disbursed_once ON advance_events(advance_id) WHERE action='DISBURSE';
CREATE UNIQUE INDEX advance_approved_once ON advance_events(advance_id) WHERE action='APPROVE';
CREATE UNIQUE INDEX advance_review_once ON advance_events(settlement_id) WHERE action IN ('APPROVE','REJECT');
CREATE UNIQUE INDEX advance_return_once ON advance_events(advance_id) WHERE action='RETURN';
CREATE TRIGGER advance_events_immutable BEFORE UPDATE OR DELETE ON advance_events FOR EACH ROW EXECUTE FUNCTION sipeka_immutable_guard();
CREATE TABLE advance_settlement_lines (
 settlement_id text NOT NULL REFERENCES advance_events(id), line_no integer NOT NULL,
 receipt_key text NOT NULL REFERENCES receipt_assets(filename), coa_id text NOT NULL REFERENCES chart_of_accounts(id),
 amount bigint NOT NULL CHECK(amount BETWEEN 1 AND 9007199254740991), PRIMARY KEY(settlement_id,line_no), UNIQUE(settlement_id,receipt_key)
);
CREATE TABLE advance_receipt_claims(receipt_key text PRIMARY KEY REFERENCES receipt_assets(filename),advance_id text NOT NULL REFERENCES ledger_transactions(id));
CREATE TRIGGER advance_lines_immutable BEFORE UPDATE OR DELETE ON advance_settlement_lines FOR EACH ROW EXECUTE FUNCTION sipeka_immutable_guard();
CREATE TRIGGER advance_claims_immutable BEFORE UPDATE OR DELETE ON advance_receipt_claims FOR EACH ROW EXECUTE FUNCTION sipeka_immutable_guard();
CREATE FUNCTION advance_command(token_value text, operation text, p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor app_users%ROWTYPE; tx ledger_transactions%ROWTYPE; prior advance_events%ROWTYPE;
 event_id text; result_value jsonb; submission advance_events%ROWTYPE; approval advance_events%ROWTYPE;
 total numeric:=0; cash_delta numeric:=0; expense_delta numeric:=0; surplus numeric:=0; linked text; l jsonb; n integer:=0;
BEGIN
 SELECT u.* INTO actor FROM sessions s JOIN app_users u ON u.id=s.user_id
 WHERE s.token=token_value AND s.purpose='full' AND s.expired_at>(clock_timestamp() AT TIME ZONE 'UTC');
 IF NOT FOUND THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
 IF operation IS NULL OR operation NOT IN ('DISBURSE','SUBMIT','APPROVE','REJECT','RETURN') THEN RAISE EXCEPTION 'OPERATION_UNSUPPORTED'; END IF;
 IF operation='SUBMIT' THEN
  IF actor.role<>'STAFF' THEN RAISE EXCEPTION 'STAFF_REQUIRED' USING ERRCODE='42501'; END IF;
 ELSIF actor.role<>'OWNER' THEN RAISE EXCEPTION 'OWNER_REQUIRED' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR jsonb_typeof(p->'idempotencyKey') IS DISTINCT FROM 'string'
 OR length(coalesce(p->>'idempotencyKey','')) NOT BETWEEN 1 AND 128
 OR jsonb_typeof(p->'evidence') IS DISTINCT FROM 'string' OR length(coalesce(p->>'evidence','')) NOT BETWEEN 10 AND 2000 THEN RAISE EXCEPTION 'EVIDENCE_AND_KEY_REQUIRED'; END IF;
 -- Same lock as existing request transactions / closing. Atomic across ledger receipt reuse and cash snapshots.
 PERFORM pg_advisory_xact_lock(1397313611::bigint);
 SELECT * INTO tx FROM ledger_transactions WHERE id=p->>'advanceId';
 IF NOT FOUND THEN RAISE EXCEPTION 'ADVANCE_NOT_FOUND'; END IF;
 IF operation='SUBMIT' AND (tx.user_id<>actor.id OR tx.branch_id IS DISTINCT FROM actor.assigned_branch_id) THEN RAISE EXCEPTION 'OWN_ADVANCE_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT * INTO prior FROM advance_events WHERE actor_id=actor.id AND branch_id=tx.branch_id AND action=operation AND idempotency_key=p->>'idempotencyKey';
 IF FOUND THEN
  IF prior.request<>p OR prior.advance_id<>tx.id THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
  RETURN prior.result;
 END IF;
 -- Replay precedes cutoff. Cash affects the creator's current WIB shift, never request day.
 IF operation IN ('DISBURSE','RETURN','SUBMIT') AND EXISTS(SELECT 1 FROM cash_closings WHERE user_id=tx.user_id AND branch_id=tx.branch_id AND closing_date=(clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date) THEN RAISE EXCEPTION 'ADVANCE_SHIFT_CLOSED'; END IF;
 IF tx.status<>'APPROVED' OR tx.tx_intent IS DISTINCT FROM 'PENGAJUAN_DANA' OR tx.tx_type<>'EXPENSE' OR tx.payment_method<>'CASH_DRAWER' THEN RAISE EXCEPTION 'APPROVED_CASH_ADVANCE_REQUIRED'; END IF;
 event_id:=md5(clock_timestamp()::text||random()::text||actor.id);
 IF operation='DISBURSE' THEN
  IF EXISTS(SELECT 1 FROM advance_events WHERE advance_id=tx.id AND action='DISBURSE') THEN RAISE EXCEPTION 'ALREADY_DISBURSED'; END IF;
  total:=tx.amount;cash_delta:=-total;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM advance_events WHERE advance_id=tx.id AND action='DISBURSE') THEN RAISE EXCEPTION 'DISBURSEMENT_REQUIRED'; END IF;
  IF operation='SUBMIT' THEN
   IF EXISTS(SELECT 1 FROM advance_events WHERE advance_id=tx.id AND action='APPROVE') THEN RAISE EXCEPTION 'SETTLEMENT_ALREADY_APPROVED'; END IF;
   IF EXISTS(SELECT 1 FROM advance_events e WHERE e.advance_id=tx.id AND e.action='SUBMIT' AND NOT EXISTS(SELECT 1 FROM advance_events r WHERE r.settlement_id=e.id AND r.action IN ('APPROVE','REJECT'))) THEN RAISE EXCEPTION 'SETTLEMENT_PENDING'; END IF;
   IF jsonb_typeof(p->'lines') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'FULL_SETTLEMENT_LINES_REQUIRED'; END IF;
   IF jsonb_array_length(p->'lines') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'FULL_SETTLEMENT_LINES_REQUIRED'; END IF;
   FOR l IN SELECT value FROM jsonb_array_elements(p->'lines') LOOP
    IF jsonb_typeof(l->'amount') IS DISTINCT FROM 'string' OR coalesce(l->>'amount','') !~ '^[1-9][0-9]{0,15}$' THEN RAISE EXCEPTION 'EXACT_IDR_REQUIRED'; END IF;
    IF (l->>'amount')::numeric>9007199254740991 THEN RAISE EXCEPTION 'EXACT_IDR_REQUIRED'; END IF;
    IF NOT EXISTS(SELECT 1 FROM receipt_assets WHERE filename=regexp_replace(l->>'receiptKey','^/api/receipts/','') AND user_id=tx.user_id AND branch_id=tx.branch_id)
    OR EXISTS(SELECT 1 FROM ledger_transactions WHERE regexp_replace(receipt_key,'^/api/receipts/','')=regexp_replace(l->>'receiptKey','^/api/receipts/',''))
    OR EXISTS(SELECT 1 FROM advance_receipt_claims WHERE receipt_key=regexp_replace(l->>'receiptKey','^/api/receipts/','') AND advance_id<>tx.id) THEN RAISE EXCEPTION 'RECEIPT_SCOPE_OR_USED'; END IF;
    IF NOT EXISTS(SELECT 1 FROM chart_of_accounts WHERE id=l->>'coaId' AND account_type='EXPENSE') THEN RAISE EXCEPTION 'EXPENSE_CATEGORY_REQUIRED'; END IF;
    total:=total+(l->>'amount')::numeric;
   END LOOP;
   IF total>tx.amount THEN RAISE EXCEPTION 'SUPPLEMENTAL_DISBURSEMENT_REQUIRED'; END IF;
  ELSIF operation IN ('APPROVE','REJECT') THEN
   SELECT * INTO submission FROM advance_events WHERE id=p->>'settlementId' AND advance_id=tx.id AND action='SUBMIT';
   IF NOT FOUND THEN RAISE EXCEPTION 'SETTLEMENT_NOT_FOUND'; END IF;
   IF EXISTS(SELECT 1 FROM advance_events WHERE settlement_id=submission.id AND action IN ('APPROVE','REJECT')) THEN RAISE EXCEPTION 'SETTLEMENT_REVIEW_FINAL'; END IF;
   linked:=submission.id;total:=submission.amount;
   IF operation='APPROVE' THEN
    IF EXISTS(SELECT 1 FROM advance_settlement_lines l JOIN receipt_assets r ON r.filename=l.receipt_key WHERE l.settlement_id=linked AND (r.user_id<>tx.user_id OR r.branch_id IS DISTINCT FROM tx.branch_id))
    OR EXISTS(SELECT 1 FROM advance_settlement_lines l JOIN ledger_transactions t ON regexp_replace(t.receipt_key,'^/api/receipts/','')=l.receipt_key WHERE l.settlement_id=linked) THEN RAISE EXCEPTION 'RECEIPT_SCOPE_OR_USED'; END IF;
    expense_delta:=total;surplus:=tx.amount-total;
   END IF;
  ELSIF operation='RETURN' THEN
   SELECT * INTO approval FROM advance_events WHERE advance_id=tx.id AND action='APPROVE';
   IF NOT FOUND THEN RAISE EXCEPTION 'APPROVED_SETTLEMENT_REQUIRED'; END IF;
   IF EXISTS(SELECT 1 FROM advance_events WHERE advance_id=tx.id AND action='RETURN') THEN RAISE EXCEPTION 'RETURN_ALREADY_CONFIRMED'; END IF;
   surplus:=tx.amount-approval.amount;
   IF jsonb_typeof(p->'amount') IS DISTINCT FROM 'string' OR coalesce(p->>'amount','') !~ '^[1-9][0-9]{0,15}$' THEN RAISE EXCEPTION 'EXACT_IDR_REQUIRED'; END IF;
   IF (p->>'amount')::numeric<>surplus OR surplus<=0 THEN RAISE EXCEPTION 'FULL_SURPLUS_RETURN_REQUIRED'; END IF;
   total:=surplus;cash_delta:=surplus;linked:=approval.settlement_id;surplus:=0;
  END IF;
 END IF;
 result_value:=jsonb_build_object('id',event_id,'advanceId',tx.id,'action',operation,'cashDelta',cash_delta::text,'expenseDelta',expense_delta::text,'returnDue',surplus::text);
 INSERT INTO advance_events(id,advance_id,branch_id,actor_id,action,settlement_id,idempotency_key,request,result,amount)
 VALUES(event_id,tx.id,tx.branch_id,actor.id,operation,linked,p->>'idempotencyKey',p,result_value,total::bigint);
 IF operation='SUBMIT' THEN
  FOR l IN SELECT value FROM jsonb_array_elements(p->'lines') LOOP
   n:=n+1;
   INSERT INTO advance_receipt_claims VALUES(regexp_replace(l->>'receiptKey','^/api/receipts/',''),tx.id) ON CONFLICT DO NOTHING;
   INSERT INTO advance_settlement_lines VALUES(event_id,n,regexp_replace(l->>'receiptKey','^/api/receipts/',''),l->>'coaId',(l->>'amount')::bigint);
  END LOOP;
 END IF;
 RETURN result_value;
END $$;
-- Reserve receipts against subsequent ordinary SETOR_NOTA INSERT without changing old rows.
CREATE FUNCTION advance_ordinary_receipt_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(1397313611::bigint);
 IF NEW.receipt_key IS NOT NULL AND EXISTS(SELECT 1 FROM advance_receipt_claims WHERE receipt_key=regexp_replace(NEW.receipt_key,'^/api/receipts/','')) THEN RAISE EXCEPTION 'RECEIPT_RESERVED_FOR_ADVANCE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER advance_ordinary_receipt_reserved BEFORE INSERT ON ledger_transactions FOR EACH ROW EXECUTE FUNCTION advance_ordinary_receipt_guard();
CREATE FUNCTION advance_read(token_value text, operation text, p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor app_users%ROWTYPE; value jsonb;
BEGIN
 SELECT u.* INTO actor FROM sessions s JOIN app_users u ON u.id=s.user_id WHERE s.token=token_value AND s.purpose='full' AND s.expired_at>(clock_timestamp() AT TIME ZONE 'UTC');
 IF NOT FOUND THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
 IF operation='CASH' THEN
  IF actor.role='STAFF' AND (p->>'branchId') IS DISTINCT FROM actor.assigned_branch_id THEN RAISE EXCEPTION 'OWN_ADVANCE_REQUIRED' USING ERRCODE='42501'; END IF;
  SELECT jsonb_build_object('cashDelta',coalesce(sum(CASE WHEN action='DISBURSE' THEN -amount::numeric WHEN action='RETURN' THEN amount::numeric ELSE 0 END),0)::text,'basis','RECORDED_DAY_MOVEMENT','openingBalances','MISSING','carryforward','UNVERIFIED','reconciliationComplete',false,'endBalance',NULL,'neracaComplete',false) INTO value FROM advance_events WHERE branch_id=p->>'branchId' AND (created_at AT TIME ZONE 'Asia/Jakarta')::date=(clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date;
  RETURN value;
 ELSIF operation='SNAPSHOT' THEN
  IF actor.role<>'OWNER' THEN RAISE EXCEPTION 'OWNER_REQUIRED' USING ERRCODE='42501'; END IF;
  SELECT coalesce(jsonb_agg(row_to_json(q)),'[]'::jsonb) INTO value FROM (
   SELECT t.id "advanceId",t.branch_id "branchId",t.user_id "userId",t.amount::text "approvedAmount",t.memo,
   coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'amount',e.amount::text,'createdAt',e.created_at,'settlementId',e.settlement_id,'evidence',e.request->>'evidence','lines',(SELECT jsonb_agg(jsonb_build_object('receiptKey',l.receipt_key,'coaId',l.coa_id,'amount',l.amount::text)) FROM advance_settlement_lines l WHERE l.settlement_id=CASE WHEN e.action='APPROVE' THEN e.settlement_id ELSE e.id END)) ORDER BY e.created_at,e.id) FROM advance_events e WHERE e.advance_id=t.id),'[]'::jsonb) events
   FROM ledger_transactions t WHERE t.tx_intent='PENGAJUAN_DANA' AND t.status='APPROVED' AND t.tx_type='EXPENSE' AND t.payment_method='CASH_DRAWER'
  ) q;
  RETURN jsonb_build_object('rows',value,'openingBalances','MISSING','neracaComplete',false);
 ELSIF operation='OWN' THEN
  IF actor.role<>'STAFF' THEN RAISE EXCEPTION 'STAFF_REQUIRED' USING ERRCODE='42501'; END IF;
  SELECT coalesce(jsonb_agg(v ORDER BY v->>'advanceId'),'[]'::jsonb) INTO value FROM (
   SELECT jsonb_build_object('advanceId',t.id,'branchId',t.branch_id,'approvedAmount',t.amount::text,
    'userId',t.user_id,
    'events',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'amount',e.amount::text,'createdAt',e.created_at,'settlementId',e.settlement_id,'evidence',e.request->>'evidence','lines',(SELECT jsonb_agg(jsonb_build_object('receiptKey',l.receipt_key,'coaId',l.coa_id,'amount',l.amount::text)) FROM advance_settlement_lines l WHERE l.settlement_id=CASE WHEN e.action='APPROVE' THEN e.settlement_id ELSE e.id END)) ORDER BY e.created_at,e.id) FROM advance_events e WHERE e.advance_id=t.id),'[]'::jsonb),
    'disbursed',EXISTS(SELECT 1 FROM advance_events WHERE advance_id=t.id AND action='DISBURSE'),
    'settlementApproved',EXISTS(SELECT 1 FROM advance_events WHERE advance_id=t.id AND action='APPROVE'),
    'returnDue',coalesce((SELECT (t.amount-e.amount)::text FROM advance_events e WHERE e.advance_id=t.id AND e.action='APPROVE'),'0')) v
   FROM ledger_transactions t WHERE t.user_id=actor.id AND t.branch_id=actor.assigned_branch_id AND t.tx_intent='PENGAJUAN_DANA' AND t.status='APPROVED' AND t.tx_type='EXPENSE' AND t.payment_method='CASH_DRAWER'
   AND NOT EXISTS(SELECT 1 FROM advance_events e WHERE e.advance_id=t.id AND e.action='APPROVE' AND (e.amount=t.amount OR EXISTS(SELECT 1 FROM advance_events r WHERE r.advance_id=t.id AND r.action='RETURN')))
  ) q;
  RETURN jsonb_build_object('rows',value);
 ELSIF operation='REPORT' THEN
  IF actor.role<>'OWNER' THEN RAISE EXCEPTION 'OWNER_REQUIRED' USING ERRCODE='42501'; END IF;
  IF coalesce(p->>'start','') !~ '^\d{4}-\d{2}-\d{2}$' OR coalesce(p->>'end','') !~ '^\d{4}-\d{2}-\d{2}$' OR (p->>'start')::date>(p->>'end')::date THEN RAISE EXCEPTION 'DATE_RANGE_REQUIRED'; END IF;
  SELECT jsonb_build_object('cashDelta',coalesce(sum(CASE WHEN action='DISBURSE' THEN -amount::numeric WHEN action='RETURN' THEN amount::numeric ELSE 0 END),0)::text,
   'expenseDelta',coalesce(sum(CASE WHEN action='APPROVE' THEN amount::numeric ELSE 0 END),0)::text,
   'disbursed',coalesce(sum(CASE WHEN action='DISBURSE' THEN amount::numeric ELSE 0 END),0)::text,
   'returned',coalesce(sum(CASE WHEN action='RETURN' THEN amount::numeric ELSE 0 END),0)::text,
   'events',count(*)::text,'openingBalances','MISSING','neracaComplete',false,'basis','ADVANCE_EVENT_MOVEMENTS',
   'start',p->>'start','end',p->>'end','branchId',p->>'branchId') INTO value
  FROM advance_events WHERE (created_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN (p->>'start')::date AND (p->>'end')::date AND (p->>'branchId' IS NULL OR branch_id=p->>'branchId');
  RETURN value;
 ELSE RAISE EXCEPTION 'OPERATION_UNSUPPORTED'; END IF;
END $$;
REVOKE ALL ON FUNCTION advance_command(text,text,jsonb),advance_read(text,text,jsonb),advance_ordinary_receipt_guard() FROM PUBLIC;
DO $$ DECLARE s text:=current_schema(); BEGIN
 EXECUTE format('ALTER FUNCTION %I.advance_command(text,text,jsonb) SET search_path = %I, pg_temp',s,s);
 EXECUTE format('ALTER FUNCTION %I.advance_read(text,text,jsonb) SET search_path = %I, pg_temp',s,s);
 EXECUTE format('ALTER FUNCTION %I.advance_ordinary_receipt_guard() SET search_path = %I, pg_temp',s,s);
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sipeka_runtime') THEN
 EXECUTE format('GRANT EXECUTE ON FUNCTION %I.advance_command(text,text,jsonb),%I.advance_read(text,text,jsonb) TO sipeka_runtime',s,s);
 END IF;
END $$;
