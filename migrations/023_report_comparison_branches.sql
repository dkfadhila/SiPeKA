-- Bind future comparison documents to their exact branches; historical rows remain immutable.
ALTER TABLE document_registry ADD COLUMN branch_ids text[];
ALTER TABLE document_registry ADD CONSTRAINT document_comparison_branches CHECK(branch_ids IS NULL OR (view_mode='comparison' AND cardinality(branch_ids) BETWEEN 2 AND 100));
CREATE OR REPLACE FUNCTION document_issue(token_value text,op text,p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor app_users;doc document_registry;u business_units;report_value text;report_prefix text;unit_value text;bid text;mode_value text;branches_value text[];df date;dt date;month_value integer;year_value integer;seq bigint;roman text;result jsonb;
BEGIN
 actor:=operational_actor(token_value);
 IF actor.role<>'OWNER' THEN RAISE EXCEPTION 'DOCUMENT_OWNER_REQUIRED' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'DOCUMENT_INVALID_REQUEST'; END IF;
 IF op='GET' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k<>'id') THEN RAISE EXCEPTION 'DOCUMENT_INVALID_REQUEST'; END IF;
  SELECT * INTO doc FROM document_registry WHERE id=(p->>'id')::uuid AND owner_id=actor.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'DOCUMENT_NOT_FOUND'; END IF;
 ELSIF op='ISSUE' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN('id','idempotency_key','report_id','branch_id','date_from','date_to','view_mode','branch_ids')) OR EXISTS(SELECT 1 FROM unnest(ARRAY['id','idempotency_key','report_id','branch_id','date_from','date_to','view_mode']) k WHERE jsonb_typeof(p->k) IS DISTINCT FROM 'string') THEN RAISE EXCEPTION 'DOCUMENT_INVALID_REQUEST'; END IF;
  report_value:=p->>'report_id';
  report_prefix:=CASE report_value WHEN 'fund-position' THEN 'NRC' WHEN 'recorded-income-expense' THEN 'PNB' WHEN 'company-profit-loss' THEN 'LBR' WHEN 'compare-profit-loss' THEN 'LBR' WHEN 'profit-loss' THEN 'LBR' WHEN 'cash-flow' THEN 'AKS' WHEN 'expense-breakdown' THEN 'RBP' WHEN 'branch-performance' THEN 'KCB' WHEN 'branch-accountability' THEN 'PJC' WHEN 'budget-actual' THEN 'ANG' WHEN 'tax-summary' THEN 'PJK' WHEN 'ppn' THEN 'PPN' WHEN 'pph21' THEN 'PPD' WHEN 'pph4' THEN 'PPF' WHEN 'pbjt' THEN 'PBJ' WHEN 'umkm' THEN 'UMK' WHEN 'tax-checklist' THEN 'KPP' WHEN 'general-ledger' THEN 'BKU' WHEN 'management-report' THEN 'MGT' WHEN 'audit-evidence' THEN 'BKT' WHEN 'fund-requests' THEN 'PDN' WHEN 'daily-closings' THEN 'CLS' WHEN 'quarterly-owner' THEN 'LTP' WHEN 'quarterly-data' THEN 'DTP' END;
  IF report_prefix IS NULL OR coalesce(p->>'branch_id','')='' OR length(p->>'branch_id')>128 OR p->>'branch_id' ~ '[[:cntrl:]]' OR p->>'date_from' !~ '^\d{4}-\d{2}-\d{2}$' OR p->>'date_to' !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'DOCUMENT_INVALID_REQUEST'; END IF;
  bid:=nullif(p->>'branch_id','all');mode_value:=p->>'view_mode';df:=(p->>'date_from')::date;dt:=(p->>'date_to')::date;
  IF df<'2000-01-01' OR dt>'2100-12-31' OR df>dt OR (report_value<>'general-ledger' AND dt-df>365) OR df::text<>p->>'date_from' OR dt::text<>p->>'date_to' THEN RAISE EXCEPTION 'DOCUMENT_INVALID_REQUEST'; END IF;
  IF mode_value NOT IN('company','branch','comparison') OR ((mode_value='branch')<>(bid IS NOT NULL)) THEN RAISE EXCEPTION 'DOCUMENT_INVALID_SCOPE'; END IF;
  IF mode_value='comparison' THEN
   IF jsonb_typeof(p->'branch_ids') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'branch_ids') NOT BETWEEN 2 AND 100 THEN RAISE EXCEPTION 'DOCUMENT_INVALID_SCOPE'; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(p->'branch_ids') v WHERE jsonb_typeof(v)<>'string' OR length(v#>>'{}') NOT BETWEEN 1 AND 120 OR v#>>'{}'='all' OR v#>>'{}' ~ '[[:cntrl:]]') THEN RAISE EXCEPTION 'DOCUMENT_INVALID_SCOPE'; END IF;
   SELECT array_agg(v ORDER BY v COLLATE "C") INTO branches_value FROM jsonb_array_elements_text(p->'branch_ids') v;
   IF cardinality(branches_value)<>(SELECT count(DISTINCT v) FROM unnest(branches_value) v) THEN RAISE EXCEPTION 'DOCUMENT_INVALID_SCOPE'; END IF;
   IF EXISTS(SELECT 1 FROM unnest(branches_value) v WHERE NOT EXISTS(SELECT 1 FROM business_units b WHERE b.id=v)) THEN RAISE EXCEPTION 'DOCUMENT_BRANCH_NOT_FOUND'; END IF;
  ELSIF p ? 'branch_ids' THEN RAISE EXCEPTION 'DOCUMENT_INVALID_SCOPE';
  END IF;
  -- Serialize same-owner retries before allocating a counter; independent owners/scopes remain concurrent.
  PERFORM pg_advisory_xact_lock(hashtextextended('document-request:'||actor.id||':'||(p->>'idempotency_key')::uuid::text,0));
  SELECT * INTO doc FROM document_registry WHERE owner_id=actor.id AND idempotency_key=(p->>'idempotency_key')::uuid;
  IF FOUND THEN
   IF doc.report_id<>report_value OR doc.branch_id IS DISTINCT FROM bid OR doc.date_from<>df OR doc.date_to<>dt OR doc.view_mode<>mode_value OR doc.branch_ids IS DISTINCT FROM branches_value THEN RAISE EXCEPTION 'DOCUMENT_IDEMPOTENCY_CONFLICT'; END IF;
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
   INSERT INTO document_registry(id,owner_id,idempotency_key,code,report_id,report_code,branch_id,unit_code,date_from,date_to,view_mode,branch_ids,month,year,sequence)
    VALUES((p->>'id')::uuid,actor.id,(p->>'idempotency_key')::uuid,report_prefix||'/'||unit_value||'/'||roman||'/'||year_value||'/'||CASE WHEN seq<1000 THEN lpad(seq::text,3,'0') ELSE seq::text END,report_value,report_prefix,bid,unit_value,df,dt,mode_value,branches_value,month_value,year_value,seq) RETURNING * INTO doc;
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
