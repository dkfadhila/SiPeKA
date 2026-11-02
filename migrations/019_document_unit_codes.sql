-- Standardize new report and Owner-selected unit codes.
-- Issued documents remain immutable, and retries keep their original numbers.
-- This private resolver is also used by Owner unit registration to reject
-- effective-code collisions across explicit, overridden and legacy units.
CREATE FUNCTION document_unit_code(branch_value text) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE u business_units; unit_value text;
BEGIN
 SELECT * INTO u FROM business_units WHERE id=branch_value;
 IF u.id IS NULL THEN RAISE EXCEPTION 'DOCUMENT_BRANCH_NOT_FOUND'; END IF;
 SELECT unit_code INTO unit_value FROM document_unit_overrides WHERE branch_id=branch_value;
 IF unit_value IS NULL THEN
  unit_value:=upper(btrim(u.code));
  -- Explicit Owner codes win over names; map technical legacy codes only.
  IF left(unit_value,5)='UNIT_' THEN
   unit_value:=CASE WHEN upper(u.name) LIKE '%REDDOORZ%' THEN 'RD' ELSE substring(unit_value FROM 6) END;
  END IF;
 END IF;
 IF unit_value IS NULL OR unit_value !~ '^[A-Z]{2,4}$' OR unit_value='AMC' THEN RAISE EXCEPTION 'DOCUMENT_INVALID_UNIT'; END IF;
 RETURN unit_value;
END $$;
REVOKE ALL ON FUNCTION document_unit_code(text) FROM PUBLIC;
DO $$ DECLARE s text:=current_schema(); BEGIN
 EXECUTE format('ALTER FUNCTION %I.document_unit_code(text) SET search_path = %I, pg_temp',s,s);
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sipeka_runtime') THEN
  EXECUTE format('REVOKE ALL ON FUNCTION %I.document_unit_code(text) FROM sipeka_runtime',s);
 END IF;
END $$;

CREATE OR REPLACE FUNCTION document_issue(token_value text,op text,p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor app_users;doc document_registry;u business_units;report_value text;report_prefix text;unit_value text;bid text;mode_value text;df date;dt date;month_value integer;year_value integer;seq bigint;roman text;result jsonb;
BEGIN
 actor:=operational_actor(token_value);
 IF actor.role<>'OWNER' THEN RAISE EXCEPTION 'DOCUMENT_OWNER_REQUIRED' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'DOCUMENT_INVALID_REQUEST'; END IF;
 IF op='GET' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k<>'id') THEN RAISE EXCEPTION 'DOCUMENT_INVALID_REQUEST'; END IF;
  SELECT * INTO doc FROM document_registry WHERE id=(p->>'id')::uuid AND owner_id=actor.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'DOCUMENT_NOT_FOUND'; END IF;
 ELSIF op='ISSUE' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN('id','idempotency_key','report_id','branch_id','date_from','date_to','view_mode')) OR EXISTS(SELECT 1 FROM unnest(ARRAY['id','idempotency_key','report_id','branch_id','date_from','date_to','view_mode']) k WHERE jsonb_typeof(p->k) IS DISTINCT FROM 'string') THEN RAISE EXCEPTION 'DOCUMENT_INVALID_REQUEST'; END IF;
  report_value:=p->>'report_id';
  report_prefix:=CASE report_value WHEN 'fund-position' THEN 'NRC' WHEN 'recorded-income-expense' THEN 'PNB' WHEN 'company-profit-loss' THEN 'LBR' WHEN 'compare-profit-loss' THEN 'LBR' WHEN 'profit-loss' THEN 'LBR' WHEN 'cash-flow' THEN 'AKS' WHEN 'expense-breakdown' THEN 'RBP' WHEN 'branch-performance' THEN 'KCB' WHEN 'branch-accountability' THEN 'PJC' WHEN 'budget-actual' THEN 'ANG' WHEN 'tax-summary' THEN 'PJK' WHEN 'ppn' THEN 'PPN' WHEN 'pph21' THEN 'PPD' WHEN 'pph4' THEN 'PPF' WHEN 'pbjt' THEN 'PBJ' WHEN 'umkm' THEN 'UMK' WHEN 'tax-checklist' THEN 'KPP' WHEN 'general-ledger' THEN 'BKU' WHEN 'management-report' THEN 'MGT' WHEN 'audit-evidence' THEN 'BKT' WHEN 'fund-requests' THEN 'PDN' WHEN 'daily-closings' THEN 'CLS' WHEN 'quarterly-owner' THEN 'LTP' WHEN 'quarterly-data' THEN 'DTP' END;
  IF report_prefix IS NULL OR coalesce(p->>'branch_id','')='' OR length(p->>'branch_id')>128 OR p->>'branch_id' ~ '[[:cntrl:]]' OR p->>'date_from' !~ '^\d{4}-\d{2}-\d{2}$' OR p->>'date_to' !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'DOCUMENT_INVALID_REQUEST'; END IF;
  bid:=nullif(p->>'branch_id','all');mode_value:=p->>'view_mode';df:=(p->>'date_from')::date;dt:=(p->>'date_to')::date;
  IF df<'2000-01-01' OR dt>'2100-12-31' OR df>dt OR (report_value<>'general-ledger' AND dt-df>365) OR df::text<>p->>'date_from' OR dt::text<>p->>'date_to' THEN RAISE EXCEPTION 'DOCUMENT_INVALID_REQUEST'; END IF;
  IF mode_value NOT IN('company','branch','comparison') OR ((mode_value='branch')<>(bid IS NOT NULL)) THEN RAISE EXCEPTION 'DOCUMENT_INVALID_SCOPE'; END IF;
  -- Serialize same-owner retries before allocating a counter; independent owners/scopes remain concurrent.
  PERFORM pg_advisory_xact_lock(hashtextextended('document-request:'||actor.id||':'||(p->>'idempotency_key')::uuid::text,0));
  SELECT * INTO doc FROM document_registry WHERE owner_id=actor.id AND idempotency_key=(p->>'idempotency_key')::uuid;
  IF FOUND THEN
   IF doc.report_id<>report_value OR doc.branch_id IS DISTINCT FROM bid OR doc.date_from<>df OR doc.date_to<>dt OR doc.view_mode<>mode_value THEN RAISE EXCEPTION 'DOCUMENT_IDEMPOTENCY_CONFLICT'; END IF;
  ELSE
   IF bid IS NULL THEN unit_value:='AMC';
   ELSE
    SELECT * INTO u FROM business_units WHERE id=bid FOR SHARE;
    IF u.id IS NULL THEN RAISE EXCEPTION 'DOCUMENT_BRANCH_NOT_FOUND'; END IF;
    unit_value:=document_unit_code(bid);
   END IF;
   month_value:=extract(month FROM dt)::integer;year_value:=extract(year FROM dt)::integer;roman:=(ARRAY['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'])[month_value];
   INSERT INTO document_counters(report_code,unit_code,month,year,last_sequence) VALUES(report_prefix,unit_value,month_value,year_value,1)
    ON CONFLICT(report_code,unit_code,month,year) DO UPDATE SET last_sequence=document_counters.last_sequence+1 RETURNING last_sequence INTO seq;
   INSERT INTO document_registry(id,owner_id,idempotency_key,code,report_id,report_code,branch_id,unit_code,date_from,date_to,view_mode,month,year,sequence)
    VALUES((p->>'id')::uuid,actor.id,(p->>'idempotency_key')::uuid,report_prefix||'/'||unit_value||'/'||roman||'/'||year_value||'/'||CASE WHEN seq<1000 THEN lpad(seq::text,3,'0') ELSE seq::text END,report_value,report_prefix,bid,unit_value,df,dt,mode_value,month_value,year_value,seq) RETURNING * INTO doc;
  END IF;
 ELSE RAISE EXCEPTION 'DOCUMENT_OPERATION_INVALID';
 END IF;
 result:=to_jsonb(doc)-'owner_id'-'idempotency_key';
 RETURN result||jsonb_build_object('branch_id',coalesce(doc.branch_id,'all'),'sequence',doc.sequence::text);
END $$;
REVOKE ALL ON document_unit_overrides,document_counters,document_registry FROM PUBLIC;
REVOKE ALL ON FUNCTION document_issue(text,text,jsonb) FROM PUBLIC;
DO $$ DECLARE s text:=current_schema(); BEGIN
 EXECUTE format('ALTER FUNCTION %I.document_issue(text,text,jsonb) SET search_path = %I, pg_temp',s,s);
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sipeka_runtime') THEN
  EXECUTE format('REVOKE ALL ON %I.document_unit_overrides,%I.document_counters,%I.document_registry FROM sipeka_runtime',s,s,s);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %I.document_issue(text,text,jsonb) TO sipeka_runtime',s);
 END IF;
END $$;
