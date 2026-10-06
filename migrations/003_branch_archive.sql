-- Retention: branch deletion means archival, never deletion of financial history.
ALTER TABLE business_units ADD COLUMN archived_at timestamp(0) without time zone;
ALTER TABLE business_units ADD COLUMN archived_by text REFERENCES app_users(id);
ALTER TABLE business_units ADD COLUMN archive_reason text;
CREATE TABLE branch_audit_logs (
 id text PRIMARY KEY, branch_id text NOT NULL REFERENCES business_units(id),
 actor_id text NOT NULL REFERENCES app_users(id), action text NOT NULL CHECK(action='ARCHIVED'),
 reason text NOT NULL, reassigned_to text REFERENCES business_units(id), reassigned_users integer NOT NULL,
 created_at timestamp(0) without time zone NOT NULL DEFAULT date_trunc('second',clock_timestamp() AT TIME ZONE 'UTC')
);
CREATE TRIGGER sipeka_branch_audit_immutable BEFORE UPDATE OR DELETE ON branch_audit_logs
 FOR EACH ROW EXECUTE FUNCTION sipeka_immutable_guard();
CREATE FUNCTION sipeka_active_branch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE branch text; active integer;
BEGIN
 IF TG_TABLE_NAME='app_users' THEN branch := NEW.assigned_branch_id; ELSE branch := NEW.branch_id; END IF;
 IF branch IS NULL THEN RETURN NEW; END IF;
 SELECT is_active INTO active FROM business_units WHERE id=branch FOR SHARE;
 IF active IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'BRANCH_INACTIVE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sipeka_tx_active_branch BEFORE INSERT ON ledger_transactions FOR EACH ROW EXECUTE FUNCTION sipeka_active_branch_guard();
CREATE TRIGGER sipeka_closing_active_branch BEFORE INSERT ON cash_closings FOR EACH ROW EXECUTE FUNCTION sipeka_active_branch_guard();
CREATE TRIGGER sipeka_receipt_active_branch BEFORE INSERT ON receipt_assets FOR EACH ROW EXECUTE FUNCTION sipeka_active_branch_guard();
CREATE TRIGGER sipeka_user_active_branch BEFORE INSERT OR UPDATE OF assigned_branch_id ON app_users FOR EACH ROW EXECUTE FUNCTION sipeka_active_branch_guard();
