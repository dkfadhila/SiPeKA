-- Owner registration uses the same effective code namespace as report/slip numbering.
-- Existing units and issued documents are retained unchanged.
CREATE FUNCTION unit_create(token_value text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor app_users; existing business_units; created business_units;
 code_value text; name_value text; category_value text; effective text;
BEGIN
 actor:=operational_actor(token_value);
 IF actor.role<>'OWNER' THEN RAISE EXCEPTION 'UNIT_OWNER_REQUIRED' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p) IS DISTINCT FROM 'object'
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN('id','code','name','category'))
  OR EXISTS(SELECT 1 FROM unnest(ARRAY['id','code','name','category']) k WHERE jsonb_typeof(p->k) IS DISTINCT FROM 'string')
  OR p->>'id' !~ '^UNIT_[a-f0-9]{24}$' THEN RAISE EXCEPTION 'UNIT_INVALID_REQUEST'; END IF;
 code_value:=p->>'code';name_value:=btrim(p->>'name');category_value:=btrim(p->>'category');
 IF code_value !~ '^[A-Z]{2,4}$' THEN RAISE EXCEPTION 'UNIT_CODE_INVALID'; END IF;
 IF code_value='AMC' THEN RAISE EXCEPTION 'UNIT_CODE_RESERVED'; END IF;
 IF length(name_value) NOT BETWEEN 1 AND 120 OR name_value ~ '[[:cntrl:]]'
  OR length(category_value) NOT BETWEEN 1 AND 64 OR category_value ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'UNIT_INVALID_REQUEST'; END IF;
 -- Serializes concurrent Owner creates, including codes derived from archived legacy units.
 PERFORM pg_advisory_xact_lock(hashtextextended('unit-code-namespace',0));
 IF EXISTS(SELECT 1 FROM business_units WHERE name=name_value) THEN RAISE EXCEPTION 'UNIT_NAME_DUPLICATE'; END IF;
 FOR existing IN SELECT * FROM business_units LOOP
  IF upper(btrim(existing.code))=code_value THEN RAISE EXCEPTION 'UNIT_CODE_DUPLICATE'; END IF;
  BEGIN
   effective:=document_unit_code(existing.id);
  EXCEPTION WHEN raise_exception THEN
   -- A historical invalid code has no usable document identity. Do not manufacture one.
   IF SQLERRM<>'DOCUMENT_INVALID_UNIT' THEN RAISE; END IF;
   effective:=NULL;
  END;
  IF effective=code_value THEN RAISE EXCEPTION 'UNIT_CODE_DUPLICATE'; END IF;
 END LOOP;
 INSERT INTO business_units(id,code,name,category,is_active)
  VALUES(p->>'id',code_value,name_value,category_value,1) RETURNING * INTO created;
 RETURN jsonb_build_object('ok',true,'id',created.id,'name',created.name,'code',created.code);
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'UNIT_CODE_DUPLICATE';
END $$;
REVOKE ALL ON FUNCTION unit_create(text,jsonb) FROM PUBLIC;
DO $$ DECLARE s text:=current_schema(); BEGIN
 EXECUTE format('ALTER FUNCTION %I.unit_create(text,jsonb) SET search_path = %I, pg_temp',s,s);
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sipeka_runtime') THEN
  EXECUTE format('GRANT EXECUTE ON FUNCTION %I.unit_create(text,jsonb) TO sipeka_runtime',s);
 END IF;
 IF current_database()='sipeka_stage' AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sipeka_stage_runtime') THEN
  EXECUTE format('GRANT EXECUTE ON FUNCTION %I.unit_create(text,jsonb) TO sipeka_stage_runtime',s);
 END IF;
END $$;
