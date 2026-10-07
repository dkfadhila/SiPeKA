-- Runtime master-data repair. No table-wide UPDATE, CREATE, DELETE or guard changes.
-- Schema-local so the same migration can be exercised against isolated fixtures.
-- Deployments without this separately provisioned role need their own explicit grants.
DO $$
DECLARE target_schema text := current_schema();
BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sipeka_runtime') THEN
  EXECUTE format('GRANT UPDATE (name,is_active,archived_at,archived_by,archive_reason) ON TABLE %I.business_units TO sipeka_runtime',target_schema);
  EXECUTE format('GRANT UPDATE (assigned_branch_id) ON TABLE %I.app_users TO sipeka_runtime',target_schema);
 END IF;
END $$;
