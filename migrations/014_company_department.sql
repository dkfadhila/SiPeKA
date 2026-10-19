-- One company; people keep department and unit separately from device login.
ALTER TABLE operational_staff ADD COLUMN department text CHECK(department IS NULL OR (length(btrim(department)) BETWEEN 1 AND 120 AND department !~ '[[:cntrl:]]'));
CREATE TABLE company_profile (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 80 AND name !~ '[[:cntrl:]]'),
 revision integer NOT NULL DEFAULT 1,
 updated_by text NOT NULL REFERENCES app_users(id),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION company_profile_access(token_value text,p jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor app_users; old company_profile; item company_profile; label text;
BEGIN
 actor:=operational_actor(token_value);
 IF p IS NULL THEN RETURN coalesce((SELECT jsonb_build_object('name',name,'revision',revision) FROM company_profile WHERE singleton),'{}'::jsonb); END IF;
 IF actor.role<>'OWNER' THEN RAISE EXCEPTION 'OPERATIONAL_OWNER_REQUIRED' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN('name','revision')) OR jsonb_typeof(p->'name') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'OPERATIONAL_INPUT_INVALID'; END IF;
 label:=btrim(p->>'name');
 IF length(label) NOT BETWEEN 1 AND 80 OR label ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'OPERATIONAL_INPUT_INVALID'; END IF;
 PERFORM pg_advisory_xact_lock(1397313611::bigint);
 SELECT * INTO old FROM company_profile WHERE singleton FOR UPDATE;
 IF coalesce((p->>'revision')::integer,0) IS DISTINCT FROM coalesce(old.revision,0) THEN RAISE EXCEPTION 'OPERATIONAL_STALE_SELECTION'; END IF;
 INSERT INTO company_profile(singleton,name,updated_by) VALUES(true,label,actor.id)
 ON CONFLICT(singleton) DO UPDATE SET name=excluded.name,revision=company_profile.revision+1,updated_by=actor.id,updated_at=clock_timestamp() RETURNING * INTO item;
 INSERT INTO operational_staff_audit VALUES(md5(random()::text||clock_timestamp()::text),actor.id,'company','COMPANY_EDIT',to_jsonb(old),to_jsonb(item),clock_timestamp());
 RETURN jsonb_build_object('name',item.name,'revision',item.revision);
END $$;
REVOKE ALL ON company_profile FROM PUBLIC;
REVOKE ALL ON FUNCTION company_profile_access(text,jsonb) FROM PUBLIC;
DO $$ DECLARE s text:=current_schema(); BEGIN
 EXECUTE format('ALTER FUNCTION %I.company_profile_access(text,jsonb) SET search_path = %I, pg_temp',s,s);
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sipeka_runtime') THEN
  EXECUTE format('REVOKE ALL ON %I.company_profile FROM sipeka_runtime',s);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %I.company_profile_access(text,jsonb) TO sipeka_runtime',s);
 END IF;
END $$;
CREATE OR REPLACE FUNCTION operational_directory(token_value text, p jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor app_users; old operational_staff; row operational_staff; bid text; nid text; label text; device app_users; before_device jsonb;
BEGIN
 actor:=operational_actor(token_value);
 IF p IS NULL THEN
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.name,s.id) FROM operational_staff s WHERE actor.role='OWNER' OR (s.branch_id=actor.assigned_branch_id AND s.active AND EXISTS(SELECT 1 FROM business_units b WHERE b.id=s.branch_id AND b.is_active=1))),'[]'::jsonb);
 END IF;
 IF actor.role<>'OWNER' THEN RAISE EXCEPTION 'OPERATIONAL_OWNER_REQUIRED' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(1397313611::bigint);
 IF jsonb_typeof(p)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN('id','name','branch_id','active','revision','device_id','department')) THEN RAISE EXCEPTION 'OPERATIONAL_INPUT_INVALID'; END IF;
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
 nid:=p->>'id';
 IF nid IS NOT NULL THEN
  SELECT * INTO old FROM operational_staff WHERE id=nid FOR UPDATE;
  IF old.id IS NULL OR (p->>'revision')::integer IS DISTINCT FROM old.revision THEN RAISE EXCEPTION 'OPERATIONAL_STALE_SELECTION'; END IF;
  UPDATE operational_staff SET name=label,branch_id=bid,active=(p->>'active')::boolean,department=CASE WHEN p?'department' THEN nullif(btrim(p->>'department'),'') ELSE department END,revision=revision+1 WHERE id=nid RETURNING * INTO row;
 ELSE
  nid:=md5(random()::text||clock_timestamp()::text);
  INSERT INTO operational_staff(id,name,branch_id,active,department) VALUES(nid,label,bid,(p->>'active')::boolean,nullif(btrim(p->>'department'),'')) RETURNING * INTO row;
 END IF;
 INSERT INTO operational_staff_audit VALUES(md5(random()::text||clock_timestamp()::text),actor.id,nid,CASE WHEN old.id IS NULL THEN 'CREATE' ELSE 'EDIT' END,to_jsonb(old),to_jsonb(row),clock_timestamp());
 RETURN to_jsonb(row);
END $$;


ALTER TABLE operational_attributions ADD COLUMN staff_department text;
CREATE OR REPLACE FUNCTION operational_capture() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE ctx jsonb; item jsonb:=to_jsonb(NEW); aid text; bid text; eid text;
BEGIN
 ctx:=nullif(current_setting('sipeka.operation',true),'')::jsonb;
 IF ctx IS NULL THEN
  -- Maintenance-created synthetic fixtures only. Runtime can never omit attribution.
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND rolsuper) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'OPERATIONAL_CONTEXT_REQUIRED' USING ERRCODE='42501';
 END IF;
 aid:=coalesce(item->>'user_id',item->>'actor_id',item->>'reviewer_id');bid:=item->>'branch_id';eid:=coalesce(item->>'id',item->>'filename');
 IF TG_TABLE_NAME='approval_logs' THEN SELECT branch_id INTO bid FROM ledger_transactions WHERE id=item->>'transaction_id'; END IF;
 IF aid IS DISTINCT FROM ctx->>'actor' OR bid IS NULL OR (ctx->>'role'='STAFF' AND bid IS DISTINCT FROM ctx->>'branch') THEN RAISE EXCEPTION 'OPERATIONAL_ACTOR_MISMATCH' USING ERRCODE='42501'; END IF;
 INSERT INTO operational_attributions(entity_type,entity_id,device_id,branch_id,staff_id,staff_name,staff_revision,source_entity_id,staff_department)
 VALUES(TG_TABLE_NAME,eid,aid,bid,ctx->>'staff',ctx->>'name',(ctx->>'revision')::integer,item->>'settlement_id',(SELECT department FROM operational_staff WHERE id=ctx->>'staff'));
 RETURN NEW;
END $$;
DO $$ DECLARE s text:=current_schema(); BEGIN
 EXECUTE format('ALTER FUNCTION %I.operational_directory(text,jsonb) SET search_path = %I, pg_temp',s,s);
 EXECUTE format('ALTER FUNCTION %I.operational_capture() SET search_path = %I, pg_temp',s,s);
END $$;
