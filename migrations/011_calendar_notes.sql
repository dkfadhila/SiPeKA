-- Additive operational notes only; no ledger writes, seeds or provider activation.
CREATE TABLE calendar_notes (
 id text PRIMARY KEY, author_id text NOT NULL REFERENCES app_users(id),
 branch_id text REFERENCES business_units(id), note_date date NOT NULL CHECK(note_date BETWEEN '2000-01-01' AND '2100-12-31'),
 text text NOT NULL CHECK(length(btrim(text)) BETWEEN 1 AND 600 AND text !~ '[[:cntrl:]]'),
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 128),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(author_id,idempotency_key)
);
CREATE INDEX calendar_note_date_branch ON calendar_notes(note_date,branch_id,created_at,id);
CREATE TABLE calendar_note_audit (
 id text PRIMARY KEY, note_id text UNIQUE NOT NULL REFERENCES calendar_notes(id),
 actor_id text NOT NULL REFERENCES app_users(id), action text NOT NULL CHECK(action='CREATED'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER calendar_notes_immutable BEFORE UPDATE OR DELETE ON calendar_notes FOR EACH ROW EXECUTE FUNCTION sipeka_immutable_guard();
CREATE TRIGGER calendar_note_audit_immutable BEFORE UPDATE OR DELETE ON calendar_note_audit FOR EACH ROW EXECUTE FUNCTION sipeka_immutable_guard();
CREATE FUNCTION calendar_note_owner(token_value text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor text;
BEGIN
 SELECT u.id INTO actor FROM sessions s JOIN app_users u ON u.id=s.user_id WHERE s.token=token_value
 AND s.expired_at>(clock_timestamp() AT TIME ZONE 'UTC') AND s.last_seen_at>(clock_timestamp() AT TIME ZONE 'UTC')-interval '30 minutes'
 AND s.purpose='full' AND NOT u.password_change_required AND u.role='OWNER';
 IF actor IS NULL THEN RAISE EXCEPTION 'CALENDAR_OWNER_REQUIRED' USING ERRCODE='42501'; END IF;
 RETURN actor;
END $$;
CREATE FUNCTION calendar_note_create(token_value text,p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor text; old calendar_notes%ROWTYPE; nid text; bid text; d date; body text; key text;
BEGIN
 actor:=calendar_note_owner(token_value);
 IF jsonb_typeof(p)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN('date','branch_id','text','idempotency_key')) THEN RAISE EXCEPTION 'CALENDAR_INPUT_INVALID'; END IF;
 bid:=p->>'branch_id';body:=p->>'text';key:=p->>'idempotency_key';
 IF jsonb_typeof(p->'date') IS DISTINCT FROM 'string' OR coalesce(p->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' OR jsonb_typeof(p->'text') IS DISTINCT FROM 'string' OR length(btrim(coalesce(body,''))) NOT BETWEEN 1 AND 600 OR body ~ '[[:cntrl:]]' OR jsonb_typeof(p->'idempotency_key') IS DISTINCT FROM 'string' OR length(coalesce(key,'')) NOT BETWEEN 1 AND 128 OR (p?'branch_id' AND jsonb_typeof(p->'branch_id') NOT IN('string','null')) THEN RAISE EXCEPTION 'CALENDAR_INPUT_INVALID'; END IF;
 d:=(p->>'date')::date;
 IF d NOT BETWEEN '2000-01-01' AND '2100-12-31' OR d::text<>p->>'date' THEN RAISE EXCEPTION 'CALENDAR_INPUT_INVALID'; END IF;
 IF bid IS NOT NULL AND NOT EXISTS(SELECT 1 FROM business_units WHERE id=bid AND is_active=1) THEN RAISE EXCEPTION 'CALENDAR_BRANCH_INVALID'; END IF;
 PERFORM pg_advisory_xact_lock(1397313611::bigint);
 SELECT * INTO old FROM calendar_notes WHERE author_id=actor AND idempotency_key=key;
 IF FOUND THEN
  IF old.note_date<>d OR old.branch_id IS DISTINCT FROM bid OR old.text<>btrim(body) THEN RAISE EXCEPTION 'CALENDAR_IDEMPOTENCY_CONFLICT'; END IF;
  RETURN to_jsonb(old)||jsonb_build_object('idempotent',true);
 END IF;
 nid:=md5(clock_timestamp()::text||random()::text||actor);
 INSERT INTO calendar_notes(id,author_id,branch_id,note_date,text,idempotency_key) VALUES(nid,actor,bid,d,btrim(body),key);
 INSERT INTO calendar_note_audit(id,note_id,actor_id,action) VALUES(md5(nid||actor),nid,actor,'CREATED');
 SELECT * INTO old FROM calendar_notes WHERE id=nid;
 RETURN to_jsonb(old)||jsonb_build_object('idempotent',false);
END $$;
CREATE FUNCTION calendar_note_read(token_value text,bid text,df date,dt date,take integer,skip integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 PERFORM calendar_note_owner(token_value);
 IF df IS NULL OR dt IS NULL OR df>dt OR dt-df>366 OR df<'2000-01-01' OR dt>'2100-12-31' OR take IS NULL OR skip IS NULL OR take NOT BETWEEN 1 AND 101 OR skip NOT BETWEEN 0 AND 100000 THEN RAISE EXCEPTION 'CALENDAR_INPUT_INVALID'; END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT n.id,n.author_id,u.full_name author_name,n.branch_id,n.note_date,n.text,n.created_at FROM calendar_notes n JOIN app_users u ON u.id=n.author_id WHERE n.note_date BETWEEN df AND dt AND (bid IS NULL OR n.branch_id IS NOT DISTINCT FROM bid) ORDER BY n.note_date DESC,n.created_at DESC,n.id DESC LIMIT take OFFSET skip) x),'[]'::jsonb);
END $$;
REVOKE ALL ON calendar_notes,calendar_note_audit FROM PUBLIC;
REVOKE ALL ON FUNCTION calendar_note_owner(text),calendar_note_create(text,jsonb),calendar_note_read(text,text,date,date,integer,integer) FROM PUBLIC;
DO $$
DECLARE s text:=current_schema();
BEGIN
 EXECUTE format('ALTER FUNCTION %I.calendar_note_owner(text) SET search_path = %I, pg_temp',s,s);
 EXECUTE format('ALTER FUNCTION %I.calendar_note_create(text,jsonb) SET search_path = %I, pg_temp',s,s);
 EXECUTE format('ALTER FUNCTION %I.calendar_note_read(text,text,date,date,integer,integer) SET search_path = %I, pg_temp',s,s);
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sipeka_runtime') THEN
  EXECUTE format('REVOKE ALL ON %I.calendar_notes,%I.calendar_note_audit FROM sipeka_runtime',s,s);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %I.calendar_note_create(text,jsonb),%I.calendar_note_read(text,text,date,date,integer,integer) TO sipeka_runtime',s,s);
 END IF;
END $$;
