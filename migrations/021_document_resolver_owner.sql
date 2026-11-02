-- CREATE OR REPLACE preserves the issuer's historical owner. The private
-- resolver may have been installed by a different migration administrator.
-- Authorize that trusted definer only, never the application runtime/public.
DO $$ DECLARE s text:=current_schema(); issuer_owner text; BEGIN
 SELECT pg_get_userbyid(proowner) INTO issuer_owner FROM pg_proc
  WHERE oid='document_issue(text,text,jsonb)'::regprocedure AND prosecdef;
 IF issuer_owner IS NULL OR issuer_owner IN('sipeka_runtime','sipeka_stage_runtime') THEN
  RAISE EXCEPTION 'DOCUMENT_FUNCTION_OWNER_INVALID';
 END IF;
 EXECUTE format('GRANT EXECUTE ON FUNCTION %I.document_unit_code(text) TO %I',s,issuer_owner);
 EXECUTE format('REVOKE ALL ON FUNCTION %I.document_unit_code(text) FROM PUBLIC',s);
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sipeka_runtime') THEN
  EXECUTE format('REVOKE ALL ON FUNCTION %I.document_unit_code(text) FROM sipeka_runtime',s);
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sipeka_stage_runtime') THEN
  EXECUTE format('REVOKE ALL ON FUNCTION %I.document_unit_code(text) FROM sipeka_stage_runtime',s);
 END IF;
END $$;
