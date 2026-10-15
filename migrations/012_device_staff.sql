-- Additive directory and immutable attribution. No historical rewrite or account mapping.
CREATE TABLE operational_staff (
 id text PRIMARY KEY, branch_id text NOT NULL REFERENCES business_units(id),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120 AND name !~ '[[:cntrl:]]'),
 active boolean NOT NULL DEFAULT true, revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE operational_staff_audit (
 id text PRIMARY KEY, actor_id text NOT NULL REFERENCES app_users(id),
 entity_id text NOT NULL, action text NOT NULL, before_value jsonb, after_value jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE operational_attributions (
 entity_type text NOT NULL, entity_id text NOT NULL, device_id text NOT NULL REFERENCES app_users(id),
 branch_id text NOT NULL REFERENCES business_units(id), staff_id text REFERENCES operational_staff(id),
 staff_name text NOT NULL, staff_revision integer, source_entity_id text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(entity_type,entity_id)
);
CREATE TRIGGER operational_attributions_immutable BEFORE UPDATE OR DELETE ON operational_attributions FOR EACH ROW EXECUTE FUNCTION sipeka_immutable_guard();
CREATE TRIGGER operational_staff_audit_immutable BEFORE UPDATE OR DELETE ON operational_staff_audit FOR EACH ROW EXECUTE FUNCTION sipeka_immutable_guard();
CREATE TRIGGER operational_staff_no_delete BEFORE DELETE ON operational_staff FOR EACH ROW EXECUTE FUNCTION sipeka_immutable_guard();

CREATE FUNCTION operational_actor(token_value text) RETURNS app_users LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor app_users;
BEGIN
 SELECT u.* INTO actor FROM sessions s JOIN app_users u ON u.id=s.user_id
 WHERE s.token=token_value AND s.expired_at>(clock_timestamp() AT TIME ZONE 'UTC')
 AND s.last_seen_at>(clock_timestamp() AT TIME ZONE 'UTC')-interval '30 minutes'
 AND s.purpose='full' AND NOT u.password_change_required;
 IF actor.id IS NULL THEN RAISE EXCEPTION 'OPERATIONAL_SESSION_REQUIRED' USING ERRCODE='42501'; END IF;
 RETURN actor;
END $$;
CREATE FUNCTION operational_directory(token_value text, p jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor app_users; old operational_staff; row operational_staff; bid text; nid text; label text; device app_users; before_device jsonb;
BEGIN
 actor:=operational_actor(token_value);
 IF p IS NULL THEN
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.name,s.id) FROM operational_staff s WHERE actor.role='OWNER' OR (s.branch_id=actor.assigned_branch_id AND s.active AND EXISTS(SELECT 1 FROM business_units b WHERE b.id=s.branch_id AND b.is_active=1))),'[]'::jsonb);
 END IF;
 IF actor.role<>'OWNER' THEN RAISE EXCEPTION 'OPERATIONAL_OWNER_REQUIRED' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(1397313611::bigint);
 IF jsonb_typeof(p)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN('id','name','branch_id','active','revision','device_id')) THEN RAISE EXCEPTION 'OPERATIONAL_INPUT_INVALID'; END IF;
 bid:=p->>'branch_id';label:=btrim(p->>'name');
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
  UPDATE operational_staff SET name=label,branch_id=bid,active=(p->>'active')::boolean,revision=revision+1 WHERE id=nid RETURNING * INTO row;
 ELSE
  nid:=md5(random()::text||clock_timestamp()::text);
  INSERT INTO operational_staff(id,name,branch_id,active) VALUES(nid,label,bid,(p->>'active')::boolean) RETURNING * INTO row;
 END IF;
 INSERT INTO operational_staff_audit VALUES(md5(random()::text||clock_timestamp()::text),actor.id,nid,CASE WHEN old.id IS NULL THEN 'CREATE' ELSE 'EDIT' END,to_jsonb(old),to_jsonb(row),clock_timestamp());
 RETURN to_jsonb(row);
END $$;

CREATE FUNCTION operational_bind(token_value text, sid text, rev text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor app_users; staff operational_staff;
BEGIN
 actor:=operational_actor(token_value);
 IF actor.role='STAFF' THEN
  SELECT s.* INTO staff FROM operational_staff s JOIN business_units b ON b.id=s.branch_id AND b.is_active=1
  WHERE s.id=sid AND s.active AND s.branch_id=actor.assigned_branch_id AND s.revision::text=rev FOR SHARE OF s;
  IF staff.id IS NULL THEN RAISE EXCEPTION 'OPERATIONAL_STAFF_REQUIRED_OR_STALE' USING ERRCODE='42501'; END IF;
 END IF;
 PERFORM set_config('sipeka.operation',jsonb_build_object('actor',actor.id,'branch',actor.assigned_branch_id,'staff',staff.id,'name',coalesce(staff.name,actor.full_name),'revision',staff.revision,'role',actor.role)::text,true);
 RETURN jsonb_build_object('staff_id',staff.id,'staff_name',coalesce(staff.name,actor.full_name),'revision',staff.revision);
END $$;
CREATE FUNCTION operational_capture() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
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
 INSERT INTO operational_attributions(entity_type,entity_id,device_id,branch_id,staff_id,staff_name,staff_revision,source_entity_id)
 VALUES(TG_TABLE_NAME,eid,aid,bid,ctx->>'staff',ctx->>'name',(ctx->>'revision')::integer,item->>'settlement_id');
 RETURN NEW;
END $$;
CREATE TRIGGER operational_capture_ledger AFTER INSERT ON ledger_transactions FOR EACH ROW EXECUTE FUNCTION operational_capture();
CREATE TRIGGER operational_capture_closing AFTER INSERT ON cash_closings FOR EACH ROW EXECUTE FUNCTION operational_capture();
CREATE TRIGGER operational_capture_receipt AFTER INSERT ON receipt_assets FOR EACH ROW EXECUTE FUNCTION operational_capture();
CREATE TRIGGER operational_capture_approval AFTER INSERT ON approval_logs FOR EACH ROW EXECUTE FUNCTION operational_capture();
CREATE TRIGGER operational_capture_advance AFTER INSERT ON advance_events FOR EACH ROW EXECUTE FUNCTION operational_capture();
REVOKE ALL ON operational_staff,operational_staff_audit,operational_attributions FROM PUBLIC;
REVOKE ALL ON FUNCTION operational_actor(text),operational_directory(text,jsonb),operational_bind(text,text,text),operational_capture() FROM PUBLIC;
DO $$ DECLARE s text:=current_schema(); f text; BEGIN
 FOREACH f IN ARRAY ARRAY['operational_actor(text)','operational_directory(text,jsonb)','operational_bind(text,text,text)','operational_capture()'] LOOP
  EXECUTE format('ALTER FUNCTION %I.%s SET search_path = %I, pg_temp',s,f,s);
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sipeka_runtime') THEN
  EXECUTE format('REVOKE ALL ON %I.operational_staff,%I.operational_staff_audit,%I.operational_attributions FROM sipeka_runtime',s,s,s);
  EXECUTE format('GRANT SELECT ON %I.operational_attributions TO sipeka_runtime',s);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %I.operational_directory(text,jsonb),%I.operational_bind(text,text,text) TO sipeka_runtime',s,s);
 END IF;
END $$;
