-- Durable Owner conversations. No DELETE route or retention sweeper.
CREATE TABLE widya_sessions(id uuid PRIMARY KEY,owner_id text NOT NULL REFERENCES app_users(id),title text NOT NULL CHECK(length(title) BETWEEN 1 AND 120),hermes_session_id text NOT NULL UNIQUE,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE widya_messages(id uuid PRIMARY KEY,session_id uuid NOT NULL REFERENCES widya_sessions(id),role text NOT NULL CHECK(role IN('user','assistant')),content text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE widya_files(id uuid PRIMARY KEY,session_id uuid NOT NULL REFERENCES widya_sessions(id),message_id uuid REFERENCES widya_messages(id),name text NOT NULL,mime text NOT NULL,bytes bytea NOT NULL CHECK(octet_length(bytes) BETWEEN 1 AND 10485760),created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE widya_runs(id uuid PRIMARY KEY,session_id uuid NOT NULL REFERENCES widya_sessions(id),message_id uuid NOT NULL UNIQUE REFERENCES widya_messages(id),client_message_id uuid NOT NULL, fingerprint text NOT NULL,capability text NOT NULL,status text NOT NULL CHECK(status IN('queued','starting','running','waiting_for_approval','completed','failed','interrupted','uncertain')),cancellation_requested boolean NOT NULL DEFAULT false,request jsonb,prepared_at timestamptz,approval jsonb,hermes_run_id text,error_code text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(session_id,client_message_id));
CREATE UNIQUE INDEX widya_one_live_turn ON widya_runs(session_id) WHERE status IN('queued','starting','running','waiting_for_approval','uncertain');
CREATE INDEX widya_owner_sessions ON widya_sessions(owner_id,updated_at DESC,id DESC);
CREATE INDEX widya_session_messages ON widya_messages(session_id,created_at,id);
CREATE FUNCTION widya_access(token_value text,op text,p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor app_users;s widya_sessions;r widya_runs;m widya_messages;f widya_files;result jsonb;item jsonb;fid uuid;
BEGIN
 actor:=operational_actor(token_value);
 IF actor.role<>'OWNER' THEN RAISE EXCEPTION 'WIDYA_OWNER_REQUIRED' USING ERRCODE='42501'; END IF;
 IF op='LIST' THEN
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT ws.id,ws.title,ws.created_at,ws.updated_at,coalesce((SELECT status FROM widya_runs WHERE session_id=ws.id ORDER BY created_at DESC LIMIT 1),'idle') status FROM widya_sessions ws WHERE owner_id=actor.id AND (NOT(p?'before_time') OR (updated_at,id)<((p->>'before_time')::timestamptz,(p->>'before_id')::uuid)) ORDER BY updated_at DESC,id DESC LIMIT (p->>'limit')::integer) x),'[]'::jsonb);
 ELSIF op='CREATE' THEN
  INSERT INTO widya_sessions(id,owner_id,title,hermes_session_id) VALUES((p->>'id')::uuid,actor.id,p->>'title',p->>'hermes_session_id') RETURNING * INTO s;
  RETURN to_jsonb(s)-'owner_id'-'hermes_session_id'||jsonb_build_object('status','idle');
 END IF;
 IF op='FILE_GET' THEN
  SELECT wf.* INTO f FROM widya_files wf JOIN widya_sessions ws ON ws.id=wf.session_id WHERE wf.id=(p->>'id')::uuid AND ws.owner_id=actor.id;
  IF f.id IS NULL THEN RAISE EXCEPTION 'WIDYA_NOT_FOUND'; END IF;
  RETURN to_jsonb(f)-'bytes'||jsonb_build_object('data_base64',encode(f.bytes,'base64'));
 END IF;
 SELECT * INTO s FROM widya_sessions WHERE id=(p->>'session_id')::uuid AND owner_id=actor.id FOR UPDATE;
 IF s.id IS NULL THEN RAISE EXCEPTION 'WIDYA_NOT_FOUND'; END IF;
 IF op='READ' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at,x.id),'[]'::jsonb) INTO result FROM (
   SELECT wm.*,coalesce(wr.status,'completed') status,wr.error_code,wr.approval,wr.cancellation_requested,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',wf.id,'name',wf.name,'mime',wf.mime,'size',octet_length(wf.bytes),'url','/api/widya/files/'||wf.id)) FROM widya_files wf WHERE wf.message_id=wm.id),'[]'::jsonb) attachments
   FROM widya_messages wm LEFT JOIN widya_runs wr ON wr.message_id=wm.id WHERE wm.session_id=s.id
   AND (NOT(p?'before') OR (wm.created_at,wm.id)<(SELECT created_at,id FROM widya_messages WHERE id=(p->>'before')::uuid AND session_id=s.id)) ORDER BY wm.created_at DESC,wm.id DESC LIMIT (p->>'limit')::integer) x;
  RETURN jsonb_build_object('session',to_jsonb(s)-'owner_id'-'hermes_session_id'||jsonb_build_object('status',coalesce((SELECT status FROM widya_runs WHERE session_id=s.id ORDER BY created_at DESC LIMIT 1),'idle')),'messages',result);
 ELSIF op='UPLOAD' THEN
  INSERT INTO widya_files(id,session_id,name,mime,bytes) VALUES((p->>'id')::uuid,s.id,p->>'name',p->>'mime',decode(p->>'data_base64','base64')) RETURNING * INTO f;
  RETURN jsonb_build_object('id',f.id,'name',f.name,'mime',f.mime,'size',octet_length(f.bytes),'url','/api/widya/files/'||f.id);
 ELSIF op='STOP' THEN
  SELECT * INTO r FROM widya_runs WHERE session_id=s.id AND status IN('queued','starting','running','waiting_for_approval') FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'WIDYA_NOT_FOUND'; END IF;
  UPDATE widya_runs SET cancellation_requested=true WHERE id=r.id RETURNING * INTO r;
  RETURN to_jsonb(r);
 ELSIF op='APPROVAL' THEN
  SELECT * INTO r FROM widya_runs WHERE session_id=s.id AND status='waiting_for_approval' FOR UPDATE;
  IF r.id IS NULL OR r.approval->>'request_id' IS DISTINCT FROM p->>'request_id' THEN RAISE EXCEPTION 'WIDYA_APPROVAL_STALE'; END IF;
  RETURN to_jsonb(r);
 ELSIF op='SEND' THEN
  SELECT * INTO r FROM widya_runs WHERE session_id=s.id AND client_message_id=(p->>'client_message_id')::uuid;
  IF r.id IS NOT NULL THEN
   IF r.fingerprint<>p->>'fingerprint' THEN RAISE EXCEPTION 'WIDYA_IDEMPOTENCY_CONFLICT'; END IF;
   RETURN jsonb_build_object('id',r.id,'status',r.status,'message_id',r.message_id);
  END IF;
  IF EXISTS(SELECT 1 FROM widya_runs WHERE session_id=s.id AND status IN('queued','starting','running','waiting_for_approval','uncertain')) THEN RAISE EXCEPTION 'WIDYA_BUSY'; END IF;
  INSERT INTO widya_messages(id,session_id,role,content) VALUES((p->>'message_id')::uuid,s.id,'user',p->>'message') RETURNING * INTO m;
  FOR item IN SELECT * FROM jsonb_array_elements(p->'attachment_ids') LOOP
   fid:=(item#>>'{}')::uuid;
   UPDATE widya_files SET message_id=m.id WHERE id=fid AND session_id=s.id AND message_id IS NULL;
   IF NOT FOUND THEN RAISE EXCEPTION 'WIDYA_FILE_INVALID'; END IF;
  END LOOP;
  INSERT INTO widya_runs(id,session_id,message_id,client_message_id,fingerprint,capability,status) VALUES((p->>'id')::uuid,s.id,m.id,(p->>'client_message_id')::uuid,p->>'fingerprint',p->>'capability','queued') RETURNING * INTO r;
  UPDATE widya_sessions SET updated_at=clock_timestamp(),title=CASE WHEN title='Sesi baru' THEN left(p->>'message',80) ELSE title END WHERE id=s.id;
  RETURN jsonb_build_object('id',r.id,'status',r.status,'message_id',m.id);
 END IF;
 RAISE EXCEPTION 'WIDYA_OPERATION_INVALID';
END $$;
CREATE FUNCTION widya_worker(op text,p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE r widya_runs;s widya_sessions;result jsonb;mid uuid;item jsonb;
BEGIN
 IF op='JOBS' THEN RETURN coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT id,capability,status FROM widya_runs WHERE status IN('queued','starting','running','waiting_for_approval') ORDER BY created_at LIMIT 100) x),'[]'::jsonb); END IF;
 SELECT * INTO r FROM widya_runs WHERE id=(p->>'id')::uuid AND capability=p->>'capability' FOR UPDATE;
 IF r.id IS NULL THEN RAISE EXCEPTION 'WIDYA_NOT_FOUND'; END IF;
 SELECT * INTO s FROM widya_sessions WHERE id=r.session_id;
 IF op='LOAD' THEN
  RETURN to_jsonb(r)||jsonb_build_object('hermes_session_id',s.hermes_session_id,'message',(SELECT content FROM widya_messages WHERE id=r.message_id),'files',coalesce((SELECT jsonb_agg(to_jsonb(f)-'bytes'||jsonb_build_object('data_base64',encode(f.bytes,'base64'))) FROM widya_files f WHERE message_id=r.message_id),'[]'::jsonb));
 ELSIF op='PREPARE' THEN
  IF r.status NOT IN('queued','starting') THEN RETURN to_jsonb(r); END IF;
  PERFORM pg_advisory_xact_lock(1397313612::bigint);
  IF r.status='queued' AND (SELECT count(*) FROM widya_runs WHERE status IN('starting','running','waiting_for_approval','uncertain'))>=2 THEN RETURN to_jsonb(r); END IF;
  UPDATE widya_runs SET request=coalesce(request,p->'request'),prepared_at=coalesce(prepared_at,clock_timestamp()),status='starting',updated_at=clock_timestamp() WHERE id=r.id RETURNING * INTO r;
 ELSIF op='RUNNING' THEN
  UPDATE widya_runs SET hermes_run_id=p->>'hermes_run_id',status='running',updated_at=clock_timestamp() WHERE id=r.id AND status='starting' RETURNING * INTO r;
 ELSIF op='WAIT_APPROVAL' THEN
  UPDATE widya_runs SET status='waiting_for_approval',approval=p->'approval',updated_at=clock_timestamp() WHERE id=r.id RETURNING * INTO r;
 ELSIF op='APPROVED' THEN
  UPDATE widya_runs SET status='running',approval=NULL,updated_at=clock_timestamp() WHERE id=r.id AND status='waiting_for_approval' RETURNING * INTO r;
 ELSIF op='FINISH' THEN
  IF r.status NOT IN('queued','starting','running','waiting_for_approval','uncertain') THEN RETURN to_jsonb(r); END IF;
  IF p->>'status'='completed' THEN
   mid:=(p->>'message_id')::uuid;
   INSERT INTO widya_messages(id,session_id,role,content) VALUES(mid,s.id,'assistant',p->>'reply');
   FOR item IN SELECT * FROM jsonb_array_elements(coalesce(p->'files','[]'::jsonb)) LOOP
    INSERT INTO widya_files(id,session_id,message_id,name,mime,bytes) VALUES((item->>'id')::uuid,s.id,mid,item->>'name',item->>'mime',decode(item->>'data_base64','base64'));
   END LOOP;
  END IF;
  UPDATE widya_runs SET status=p->>'status',error_code=p->>'error_code',updated_at=clock_timestamp() WHERE id=r.id RETURNING * INTO r;
  UPDATE widya_sessions SET updated_at=clock_timestamp() WHERE id=s.id;
 END IF;
 RETURN to_jsonb(r);
END $$;
CREATE TRIGGER widya_messages_immutable BEFORE UPDATE OR DELETE ON widya_messages FOR EACH ROW EXECUTE FUNCTION sipeka_immutable_guard();
REVOKE ALL ON widya_sessions,widya_messages,widya_files,widya_runs FROM PUBLIC;
REVOKE ALL ON FUNCTION widya_access(text,text,jsonb),widya_worker(text,jsonb) FROM PUBLIC;
DO $$ DECLARE s text:=current_schema(); BEGIN
 EXECUTE format('ALTER FUNCTION %I.widya_access(text,text,jsonb) SET search_path = %I, pg_temp',s,s);
 EXECUTE format('ALTER FUNCTION %I.widya_worker(text,jsonb) SET search_path = %I, pg_temp',s,s);
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sipeka_runtime') THEN
  EXECUTE format('REVOKE ALL ON %I.widya_sessions,%I.widya_messages,%I.widya_files,%I.widya_runs FROM sipeka_runtime',s,s,s,s);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %I.widya_access(text,text,jsonb),%I.widya_worker(text,jsonb) TO sipeka_runtime',s,s);
 END IF;
END $$;
