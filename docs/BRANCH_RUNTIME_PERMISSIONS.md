# Runtime branch permission repair

## Diagnosis
Production release `5cf483f4ba322dcc28dba54f0f898b2bd64336b1` uses `sipeka_runtime` from `/etc/sipeka/runtime.env`. Read-only catalog inspection confirms SELECT/INSERT on business_units, no UPDATE on any column; app_users lacks UPDATE(assigned_branch_id). Audit tables already have SELECT/INSERT. Sessions already permit DELETE (session revocation only). Runtime is neither schema owner nor superuser and has no schema CREATE.

First failing statement in rename/archive is `SELECT * FROM business_units WHERE id=$1 FOR UPDATE`. PostgreSQL requires UPDATE privilege on at least one column for this row lock; denial is SQLSTATE `42501`, before the later branch UPDATE. Reassignment would also fail `UPDATE app_users SET assigned_branch_id=$1 WHERE id=$2`. No API defect established; db-postgres.js/server/frontend unchanged.

Migration `006_branch_runtime_permissions.sql` adds only UPDATE(name,is_active,archived_at,archived_by,archive_reason) on business_units and UPDATE(assigned_branch_id) on app_users, schema-qualified using current_schema(). No financial grants, table-wide UPDATE, DELETE, CREATE, SECURITY DEFINER or trigger changes. If the separately provisioned runtime role does not exist, migration is a no-op; alternate deployments must provision an explicit equivalent policy. The shared runtime DB identity is not a Staff/Owner identity: HTTP and adapter actor checks remain the RBAC boundary. Direct possession of runtime credentials is privileged application access, not Staff login.

## Reproduction / verification
`tests/branch-runtime-permissions.test.js` is opt-in: set BRANCH_RUNTIME_TEST=1 and DATABASE_URL privately to actual sipeka_runtime with options `-c search_path=branch_runtime_<hex>`. An administrator must pre-create/migrate that schema, copy public runtime ACLs, seed noncredential Owner/Staff fixtures and financial rows. Never point this test at public. Test refuses other role/schema names, does not create/drop schema, and leaves fixtures retained.

Observed RED: one test fails `permission denied for table business_units`, `42501`. Only isolated schema then receives migration006. Observed GREEN: one test passes. Covers runtime branch creation, Owner rename/archive, Staff actor denial, staff reassignment/session revocation, last-active protection, exact financial snapshots, forbidden financial DELETE/amount UPDATE, final-status guard, forbidden schema CREATE, trigger disabling, audit UPDATE and branch-code UPDATE.

Actual VPS loopback HTTP using unchanged deployed server copied into isolated fixture directory: Owner create 201, rename/archive 200 with DB/audit readback; Staff create/rename/archive 403. Sessions generated internally, no login passwords used. This is real HTTP against isolated PostgreSQL, not browser verification or production acceptance. Four existing local SQLite branch tests pass; PG-only regression skipped locally. Browser verification remains parent Task2.

## Rollout gate (not executed)
1. Parent reviews migration, tests, evidence and diff. Obtain explicit release authorization. No production grant changes made during task1.
2. Back up production through documented offsite procedure. Record schema_migrations and current column ACLs. Confirm target role, database, schema and release hash privately; do not print environment or URL.
3. Follow GitHub-first release workflow. Apply versioned migrations with existing maintenance role and correct public search_path, before starting the new release. New adapter startup checks require migration006 checksum. Runtime must never run migration/DDL.
4. Verify runner --verify as runtime, exact intended column privileges, absence of table-wide UPDATE/financial DELETE/schema CREATE, enabled immutable guards, readiness and Laundry-only active list. Do not mutate production business data for smoke tests without separately approved targets and fresh confirmation.
5. Parent completes browser gate and release acceptance. Do not drop retained QA schema without the required second warning and new explicit confirmation.

Rollback requires reviewed REVOKE UPDATE(column list), restoring captured prior ACLs only, plus coordinated code/migration checksum strategy. Do not delete applied schema_migrations rows or edit previous migration checksums. Narrow revocation alone restores the original operational failure; it is not an application rollback plan.

Evidence: `D:/FamilyAgent/Flora/generated/sipeka-completion/task1/`. Retained VPS schema `branch_runtime_9abadb7df9f93ac2`; fixture code `/home/ubuntu/sipeka-task1-fixture`. No commit, push, service restart, production grant change or production business mutation.
