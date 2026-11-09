-- 024: bounded recovery for the employee-payroll email delivery path.
-- 015 CLAIM sets payroll_delivery_outbox.status='sending' and relies on the Node process to
-- run FINISH. A crash, reload or deploy between CLAIM and FINISH stranded the row in
-- 'sending' forever; every later send then returned {acquired:false} while HTTP looked fine.
-- Recovery never resends: a stale claim can only be reclaimed to 'failed' with a distinct
-- code, and only an explicit Owner send re-arms that single row back to 'pending'.
-- No amounts, recipients, payloads or tokens enter the audit trail (metadata only).

-- 1. Sweeper. Runs from a timer in the server process, never per request.
--    Lease is clamped to 1..1440 minutes; out-of-range input cannot widen the window.
CREATE OR REPLACE FUNCTION payroll_recover_stale_claims(lease_minutes integer DEFAULT 15) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_lease integer; n integer;
BEGIN
 v_lease:=GREATEST(1,LEAST(coalesce(lease_minutes,15),1440));
 WITH stale AS (
  UPDATE payroll_delivery_outbox o
  SET status='failed',error_code='PAYROLL_STALE_CLAIM_RECOVERED',updated_at=clock_timestamp()
  WHERE o.channel='email' AND o.status='sending'
   AND o.updated_at<clock_timestamp()-make_interval(mins=>v_lease)
   AND EXISTS(SELECT 1 FROM payroll_entries e WHERE e.id=o.entry_id AND e.staff_id IS NOT NULL)
  RETURNING o.id,o.entry_id
 ), audited AS (
  INSERT INTO payroll_access_audit(id,actor_id,action,batch_id)
  SELECT md5(random()::text||clock_timestamp()::text||s.id),NULL,'STALE_RECLAIM',e.batch_id
  FROM stale s JOIN payroll_entries e ON e.id=s.entry_id
  RETURNING 1
 )
 SELECT count(*) INTO n FROM stale;
 RETURN jsonb_build_object('recovered',n,'lease_minutes',v_lease);
END $$;

-- 2. Pre-provider settlement. Only codes that prove the provider was never asked may
--    move a claimed row to 'failed'. Any other ambiguity must stay 'uncertain'.
CREATE OR REPLACE FUNCTION employee_payroll_fail_claim(token_value text,claim_id text,fail_code text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor app_users; job payroll_delivery_outbox; e payroll_entries;
BEGIN
 actor:=operational_actor(token_value);
 IF actor.role<>'OWNER' THEN RAISE EXCEPTION 'PAYROLL_OWNER_ONLY' USING ERRCODE='42501'; END IF;
 IF fail_code IS NULL OR fail_code NOT IN ('PAYROLL_CONTACT_CHANGED','PAYROLL_TEMPLATE_INVALID','PAYROLL_PAYLOAD_IDENTITY','PAYROLL_PROVIDER_REJECTED','PAYROLL_DELIVERY_LOCAL_FAILURE') THEN
  RAISE EXCEPTION 'PAYROLL_DELIVERY_STATUS';
 END IF;
 UPDATE payroll_delivery_outbox o SET status='failed',error_code=fail_code,updated_at=clock_timestamp()
 WHERE o.id=claim_id AND o.channel='email' AND o.status='sending'
  AND EXISTS(SELECT 1 FROM payroll_entries pe WHERE pe.id=o.entry_id AND pe.staff_id IS NOT NULL)
 RETURNING * INTO job;
 IF job.id IS NULL THEN RAISE EXCEPTION 'PAYROLL_DELIVERY_STATUS'; END IF;
 SELECT * INTO e FROM payroll_entries WHERE id=job.entry_id;
 INSERT INTO payroll_access_audit(id,actor_id,action,batch_id) VALUES(md5(random()::text||clock_timestamp()::text),actor.id,'DELIVERY_FAILED',e.batch_id);
 RETURN jsonb_build_object('id',job.id,'status',job.status,'error_code',job.error_code);
END $$;

-- 3. Explicit Owner re-arm. Only retryable codes qualify: a stale claim or a provably
--    unsent pre-provider failure. 'uncertain', 'sent', 'blocked' and 'sending' keep their
--    existing no-resend behaviour, so an ambiguous provider acceptance is never replayed.
CREATE OR REPLACE FUNCTION employee_payroll_rearm(token_value text,entry_id_value text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor app_users; e payroll_entries; job payroll_delivery_outbox;
BEGIN
 actor:=operational_actor(token_value);
 IF actor.role<>'OWNER' THEN RAISE EXCEPTION 'PAYROLL_OWNER_ONLY' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM payroll_entries WHERE id=entry_id_value AND staff_id IS NOT NULL;
 IF e.id IS NULL THEN RAISE EXCEPTION 'PAYROLL_NOT_FOUND'; END IF;
 SELECT * INTO job FROM payroll_delivery_outbox WHERE entry_id=e.id AND channel='email' FOR UPDATE;
 IF job.id IS NULL THEN RETURN jsonb_build_object('rearmed',false); END IF;
 IF job.status<>'failed' OR job.error_code IS NULL OR job.error_code NOT IN ('PAYROLL_STALE_CLAIM_RECOVERED','PAYROLL_CONTACT_CHANGED','PAYROLL_TEMPLATE_INVALID','PAYROLL_PAYLOAD_IDENTITY','PAYROLL_PROVIDER_REJECTED','PAYROLL_DELIVERY_LOCAL_FAILURE') THEN
  RETURN jsonb_build_object('rearmed',false,'status',job.status);
 END IF;
 UPDATE payroll_delivery_outbox SET status='pending',error_code=NULL,updated_at=clock_timestamp() WHERE id=job.id;
 INSERT INTO payroll_access_audit(id,actor_id,action,batch_id) VALUES(md5(random()::text||clock_timestamp()::text),actor.id,'DELIVERY_REARM',e.batch_id);
 RETURN jsonb_build_object('rearmed',true,'status','pending');
END $$;

REVOKE ALL ON FUNCTION payroll_recover_stale_claims(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION employee_payroll_fail_claim(text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION employee_payroll_rearm(text,text) FROM PUBLIC;
DO $$ DECLARE s text:=current_schema(); BEGIN
 EXECUTE format('ALTER FUNCTION %I.payroll_recover_stale_claims(integer) SET search_path = %I, pg_temp',s,s);
 EXECUTE format('ALTER FUNCTION %I.employee_payroll_fail_claim(text,text,text) SET search_path = %I, pg_temp',s,s);
 EXECUTE format('ALTER FUNCTION %I.employee_payroll_rearm(text,text) SET search_path = %I, pg_temp',s,s);
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sipeka_runtime') THEN
  EXECUTE format('GRANT EXECUTE ON FUNCTION %I.payroll_recover_stale_claims(integer) TO sipeka_runtime',s);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %I.employee_payroll_fail_claim(text,text,text) TO sipeka_runtime',s);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %I.employee_payroll_rearm(text,text) TO sipeka_runtime',s);
 END IF;
END $$;
