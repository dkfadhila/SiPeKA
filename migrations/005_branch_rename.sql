-- Rename only master display name; financial identifiers and history remain intact.
CREATE TABLE branch_rename_audit (
 id text PRIMARY KEY, branch_id text NOT NULL REFERENCES business_units(id),
 actor_id text NOT NULL REFERENCES app_users(id),old_name text NOT NULL,new_name text NOT NULL,
 created_at timestamp(0) without time zone NOT NULL DEFAULT date_trunc('second',clock_timestamp() AT TIME ZONE 'UTC')
);
CREATE TRIGGER sipeka_branch_rename_immutable BEFORE UPDATE OR DELETE ON branch_rename_audit
 FOR EACH ROW EXECUTE FUNCTION sipeka_immutable_guard();
