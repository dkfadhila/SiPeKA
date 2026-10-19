-- Reuse encrypted payroll, audit and Resend outbox; employees are not login users.
ALTER TABLE operational_staff ADD COLUMN email text CHECK(email IS NULL OR (length(email)<=254 AND email=lower(btrim(email)) AND email ~ '^[^[:space:]@<>;,]+@[^[:space:]@<>;,]+\.[^[:space:]@<>;,]+$'));
CREATE UNIQUE INDEX employee_email_unique ON operational_staff(email) WHERE email IS NOT NULL;
ALTER TABLE payroll_entries ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE payroll_entries ADD COLUMN staff_id text REFERENCES operational_staff(id);
ALTER TABLE payroll_entries ADD CONSTRAINT payroll_recipient_kind CHECK((user_id IS NULL)<>(staff_id IS NULL));
CREATE UNIQUE INDEX employee_payroll_period ON payroll_entries(period,staff_id) WHERE staff_id IS NOT NULL;
CREATE FUNCTION employee_payroll_access(token_value text,op text,p jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor app_users; b payroll_batches; e payroll_entries; s operational_staff; job payroll_delivery_outbox; item jsonb; bid text;
BEGIN
 actor:=operational_actor(token_value);
 IF actor.role<>'OWNER' THEN RAISE EXCEPTION 'PAYROLL_OWNER_ONLY' USING ERRCODE='42501'; END IF;
 IF op='LIST' THEN
  INSERT INTO payroll_access_audit(id,actor_id,action) VALUES(md5(random()::text||clock_timestamp()::text),actor.id,'EMPLOYEE_PREVIEW');
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT pe.*,pb.status,pb.published_at,pb.preview_token,po.status email_status,po.provider_id FROM payroll_entries pe JOIN payroll_batches pb ON pb.id=pe.batch_id LEFT JOIN payroll_delivery_outbox po ON po.entry_id=pe.id AND po.channel='email' WHERE pe.staff_id IS NOT NULL ORDER BY pb.created_at DESC,pe.id LIMIT 1000) x),'[]'::jsonb);
 ELSIF op='IMPORT' THEN
  IF jsonb_typeof(p->'rows') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'rows') NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'PAYROLL_CSV_ROWS'; END IF;
  bid:=p->>'id';
  INSERT INTO payroll_batches(id,period,status,created_by,preview_token) VALUES(bid,p->>'period','DRAFT',actor.id,p->>'preview_token');
  FOR item IN SELECT * FROM jsonb_array_elements(p->'rows') LOOP
   SELECT * INTO s FROM operational_staff WHERE id=item->>'staff_id' AND active FOR SHARE;
   IF s.id IS NULL OR s.department IS NULL THEN RAISE EXCEPTION 'PAYROLL_EMPLOYEE_DEPARTMENT_REQUIRED'; END IF;
   IF item->>'period' IS DISTINCT FROM p->>'period' THEN RAISE EXCEPTION 'PAYROLL_PERIOD'; END IF;
   INSERT INTO payroll_entries(id,batch_id,period,staff_id,payload_cipher) VALUES(item->>'id',bid,item->>'period',s.id,item->>'payload_cipher');
  END LOOP;
  INSERT INTO payroll_access_audit(id,actor_id,action,batch_id) VALUES(md5(random()::text||clock_timestamp()::text),actor.id,'EMPLOYEE_IMPORT',bid);
  RETURN jsonb_build_object('id',bid,'status','DRAFT');
 ELSIF op='PUBLISH' THEN
  SELECT * INTO b FROM payroll_batches WHERE id=p->>'id' FOR UPDATE;
  IF b.id IS NULL OR NOT EXISTS(SELECT 1 FROM payroll_entries WHERE batch_id=b.id AND staff_id IS NOT NULL) THEN RAISE EXCEPTION 'PAYROLL_NOT_FOUND'; END IF;
  IF p->>'preview_token' IS DISTINCT FROM b.preview_token OR p->>'confirmed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'PAYROLL_PREVIEW_TOKEN'; END IF;
  IF b.status='DRAFT' THEN UPDATE payroll_batches SET status='PUBLISHED',published_by=actor.id,published_at=clock_timestamp() WHERE id=b.id; END IF;
  INSERT INTO payroll_access_audit(id,actor_id,action,batch_id) VALUES(md5(random()::text||clock_timestamp()::text),actor.id,'EMPLOYEE_PUBLISH',b.id);
  RETURN jsonb_build_object('id',b.id,'status','PUBLISHED');
 ELSIF op='CLAIM' THEN
  SELECT * INTO e FROM payroll_entries WHERE id=p->>'id' AND staff_id IS NOT NULL;
  SELECT * INTO b FROM payroll_batches WHERE id=e.batch_id;
  SELECT * INTO s FROM operational_staff WHERE id=e.staff_id FOR SHARE;
  IF e.id IS NULL OR b.status IS DISTINCT FROM 'PUBLISHED' THEN RAISE EXCEPTION 'PAYROLL_NOT_PUBLISHED'; END IF;
  IF NOT s.active OR s.email IS NULL OR s.email IS DISTINCT FROM p->>'email' OR p->>'confirmed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'PAYROLL_CONTACT_CHANGED'; END IF;
  INSERT INTO payroll_delivery_outbox(id,entry_id,channel,status,recipient_binding_key) VALUES(p->>'job_id',e.id,'email','pending',p->>'email') ON CONFLICT(entry_id,channel) DO NOTHING;
  SELECT * INTO job FROM payroll_delivery_outbox WHERE entry_id=e.id AND channel='email' FOR UPDATE;
  IF job.status<>'pending' THEN RETURN jsonb_build_object('id',job.id,'status',job.status,'acquired',false); END IF;
  IF job.recipient_binding_key IS DISTINCT FROM s.email THEN RAISE EXCEPTION 'PAYROLL_CONTACT_CHANGED'; END IF;
  UPDATE payroll_delivery_outbox SET status='sending',attempts=attempts+1,updated_at=clock_timestamp() WHERE id=job.id;
  INSERT INTO payroll_access_audit(id,actor_id,action,batch_id) VALUES(md5(random()::text||clock_timestamp()::text),actor.id,'QUEUE_'||job.id,b.id);
  RETURN jsonb_build_object('id',job.id,'status','sending','acquired',true,'published_at',b.published_at);
 ELSIF op='FENCE' THEN
  SELECT s0.* INTO s FROM operational_staff s0 JOIN payroll_entries e0 ON e0.staff_id=s0.id WHERE e0.id=p->>'id' FOR SHARE OF s0;
  IF s.id IS NULL OR NOT s.active OR s.email IS DISTINCT FROM p->>'email' THEN RAISE EXCEPTION 'PAYROLL_CONTACT_CHANGED'; END IF;
  RETURN jsonb_build_object('ok',true);
 ELSIF op='FINISH' THEN
  IF p->>'status' NOT IN ('sent','uncertain') THEN RAISE EXCEPTION 'PAYROLL_DELIVERY_STATUS'; END IF;
  UPDATE payroll_delivery_outbox o SET status=p->>'status',provider_id=p->>'provider_id',error_code=CASE WHEN p->>'status'='uncertain' THEN 'PAYROLL_PROVIDER_ACCEPTANCE_UNKNOWN' END,updated_at=clock_timestamp()
  WHERE o.id=p->>'id' AND o.status='sending' AND EXISTS(SELECT 1 FROM payroll_entries pe WHERE pe.id=o.entry_id AND pe.staff_id IS NOT NULL) RETURNING * INTO job;
  IF job.id IS NULL THEN RAISE EXCEPTION 'PAYROLL_DELIVERY_STATUS'; END IF;
  RETURN jsonb_build_object('id',job.id,'status',job.status);
 END IF;
 RAISE EXCEPTION 'PAYROLL_OPERATION_INVALID';
END $$;
REVOKE ALL ON FUNCTION employee_payroll_access(text,text,jsonb) FROM PUBLIC;
DO $$ DECLARE s text:=current_schema(); BEGIN
 EXECUTE format('ALTER FUNCTION %I.employee_payroll_access(text,text,jsonb) SET search_path = %I, pg_temp',s,s);
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sipeka_runtime') THEN
  EXECUTE format('GRANT EXECUTE ON FUNCTION %I.employee_payroll_access(text,text,jsonb) TO sipeka_runtime',s);
 END IF;
END $$;

CREATE OR REPLACE FUNCTION operational_directory(token_value text, p jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor app_users; old operational_staff; row operational_staff; bid text; nid text; label text; device app_users; before_device jsonb;
BEGIN
 actor:=operational_actor(token_value);
 IF p IS NULL THEN
  RETURN coalesce((SELECT jsonb_agg((CASE WHEN actor.role='OWNER' THEN to_jsonb(s) ELSE to_jsonb(s)-'email' END) ORDER BY s.name,s.id) FROM operational_staff s WHERE actor.role='OWNER' OR (s.branch_id=actor.assigned_branch_id AND s.active AND EXISTS(SELECT 1 FROM business_units b WHERE b.id=s.branch_id AND b.is_active=1))),'[]'::jsonb);
 END IF;
 IF actor.role<>'OWNER' THEN RAISE EXCEPTION 'OPERATIONAL_OWNER_REQUIRED' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(1397313611::bigint);
 IF jsonb_typeof(p)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN('id','name','branch_id','active','revision','device_id','department','email','email_confirmed')) THEN RAISE EXCEPTION 'OPERATIONAL_INPUT_INVALID'; END IF;
 bid:=p->>'branch_id';label:=btrim(p->>'name');
 IF p?'department' AND (jsonb_typeof(p->'department') IS DISTINCT FROM 'string' OR length(p->>'department')>120 OR p->>'department' ~ '[[:cntrl:]]') THEN RAISE EXCEPTION 'OPERATIONAL_DEPARTMENT_INVALID'; END IF;
 IF jsonb_typeof(p->'name') IS DISTINCT FROM 'string' OR coalesce(length(label),0) NOT BETWEEN 1 AND 120 OR label ~ '[[:cntrl:]]' OR NOT EXISTS(SELECT 1 FROM business_units WHERE id=bid AND is_active=1) THEN RAISE EXCEPTION 'OPERATIONAL_INPUT_INVALID'; END IF;
 IF p?'device_id' THEN
  SELECT * INTO device FROM app_users WHERE id=p->>'device_id' AND role='STAFF' FOR UPDATE;
  IF device.id IS NULL THEN RAISE EXCEPTION 'OPERATIONAL_DEVICE_INVALID'; END IF;
  IF EXISTS(SELECT 1 FROM app_users WHERE role='STAFF' AND assigned_branch_id=bid AND id<>device.id AND lower(btrim(full_name))=lower(label)) THEN RAISE EXCEPTION 'OPERATIONAL_DEVICE_LABEL_CONFLICT'; END IF;
  before_device:=jsonb_build_object('name',device.full_name,'branch_id',device.assigned_branch_id);
  UPDATE app_users SET full_name=label,assigned_branch_id=bid WHERE id=device.id;
  INSERT INTO operational_staff_audit VALUES(md5(random()::text||clock_timestamp()::text),actor.id,device.id,'DEVICE_CONFIGURE',before_device,jsonb_build_object('name',label,'branch_id',bid),clock_timestamp());
  RETURN jsonb_build_object('id',device.id,'name',label,'branch_id',bid);
 END IF;
 IF jsonb_typeof(p->'active') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'OPERATIONAL_INPUT_INVALID'; END IF;
 IF p?'email' AND jsonb_typeof(p->'email') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'OPERATIONAL_INPUT_INVALID'; END IF;
 IF nullif(btrim(p->>'email'),'') IS NOT NULL AND (p->>'email_confirmed' IS DISTINCT FROM 'true' OR lower(btrim(p->>'email')) !~ '^[^[:space:]@<>;,]+@[^[:space:]@<>;,]+\.[^[:space:]@<>;,]+$') THEN RAISE EXCEPTION 'OPERATIONAL_EMAIL_CONFIRM_REQUIRED'; END IF;
 nid:=p->>'id';
 IF nid IS NOT NULL THEN
  SELECT * INTO old FROM operational_staff WHERE id=nid FOR UPDATE;
  IF old.id IS NULL OR (p->>'revision')::integer IS DISTINCT FROM old.revision THEN RAISE EXCEPTION 'OPERATIONAL_STALE_SELECTION'; END IF;
  UPDATE operational_staff SET name=label,branch_id=bid,active=(p->>'active')::boolean,department=CASE WHEN p?'department' THEN nullif(btrim(p->>'department'),'') ELSE department END,email=CASE WHEN p?'email' THEN nullif(lower(btrim(p->>'email')),'') ELSE email END,revision=revision+1 WHERE id=nid RETURNING * INTO row;
 ELSE
  nid:=md5(random()::text||clock_timestamp()::text);
  INSERT INTO operational_staff(id,name,branch_id,active,department,email) VALUES(nid,label,bid,(p->>'active')::boolean,nullif(btrim(p->>'department'),''),nullif(lower(btrim(p->>'email')),'')) RETURNING * INTO row;
 END IF;
 INSERT INTO operational_staff_audit VALUES(md5(random()::text||clock_timestamp()::text),actor.id,nid,CASE WHEN old.id IS NULL THEN 'CREATE' ELSE 'EDIT' END,to_jsonb(old),to_jsonb(row),clock_timestamp());
 RETURN to_jsonb(row);
END $$;
DO $$ DECLARE s text:=current_schema(); BEGIN
 EXECUTE format('ALTER FUNCTION %I.operational_directory(text,jsonb) SET search_path = %I, pg_temp',s,s);
END $$;
