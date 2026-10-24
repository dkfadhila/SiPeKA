#!/usr/bin/env python3
"""Root-only provisioning for the private Hermes read workload. No business writes.

--check is read-only. --apply creates the dedicated peer identity and minimal
column grants, then installs a fixed launcher. Existing unexpected privileges
are rejected rather than silently carried forward or removed.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROLE = 'widya_reader'
DATABASE = 'sipeka'
APP = Path('/opt/sipeka/current')
GRANTS = {
    'business_units': ['id', 'name', 'code', 'category', 'is_active'],
    'chart_of_accounts': ['id', 'account_code', 'account_name', 'account_type'],
    'ledger_transactions': ['id', 'branch_id', 'coa_id', 'tx_type', 'amount', 'payment_method', 'status', 'tx_intent', 'created_at', 'memo'],
    'advance_events': ['id', 'advance_id', 'action', 'amount', 'created_at', 'settlement_id'],
    'advance_settlement_lines': ['settlement_id', 'line_no', 'coa_id', 'amount'],
    'cash_closings': ['id', 'branch_id', 'closing_date', 'system_balance', 'physical_cash', 'difference', 'reason'],
}


def psql(sql):
    result = subprocess.run(['/usr/sbin/runuser', '-u', 'postgres', '--', '/usr/bin/psql', '-X', '-v', 'ON_ERROR_STOP=1', '-qAt', '-d', DATABASE], input=sql, text=True, capture_output=True)
    if result.returncode:
        # SQL and PostgreSQL diagnostics may contain private values; emit only a code.
        raise RuntimeError('WIDYA_READER_PROVISION_DATABASE_CHECK_FAILED')
    return result.stdout.strip()


def role_audit_sql(require_grants=False):
    allowed = json.dumps(GRANTS).replace("'", "''")
    # Evaluate effective privileges, including PUBLIC and inherited roles.
    return """
DO $audit$
DECLARE r record; c record; expected jsonb := '%s'::jsonb;
BEGIN
 SELECT * INTO r FROM pg_authid WHERE rolname='widya_reader';
 IF NOT FOUND THEN RAISE EXCEPTION 'reader role missing'; END IF;
 IF r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls OR NOT r.rolcanlogin OR r.rolinherit OR r.rolpassword IS NOT NULL
 THEN RAISE EXCEPTION 'unexpected role capability'; END IF;
 IF EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid OR roleid=r.oid)
 THEN RAISE EXCEPTION 'reader role membership'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class WHERE relowner=r.oid)
 OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspowner=r.oid)
 OR EXISTS(SELECT 1 FROM pg_proc WHERE proowner=r.oid)
 OR EXISTS(SELECT 1 FROM pg_database WHERE datdba=r.oid)
 THEN RAISE EXCEPTION 'reader owns database object'; END IF;
 FOR c IN SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%%' AND nspname <> 'information_schema' LOOP
  IF has_schema_privilege('widya_reader',c.nspname,'CREATE') THEN RAISE EXCEPTION 'reader schema create privilege'; END IF;
 END LOOP;
 IF has_database_privilege('widya_reader',current_database(),'CREATE') THEN RAISE EXCEPTION 'reader database create privilege'; END IF;
 FOR c IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prosecdef AND n.nspname NOT LIKE 'pg_%%' AND n.nspname <> 'information_schema' LOOP
  IF has_function_privilege('widya_reader',c.oid,'EXECUTE') THEN RAISE EXCEPTION 'reader security definer privilege'; END IF;
 END LOOP;
END $audit$;
""" % allowed


def privilege_audit_sql(require_grants=False):
    # Each allowed column is separate; table-level SELECT or any unlisted
    # column/table access is a configuration error, even on a previous install.
    allowed = json.dumps(GRANTS).replace("'", "''")
    require = 'true' if require_grants else 'false'
    return """
DO $audit$
DECLARE c record; a record; expected jsonb := '%s'::jsonb; wanted boolean;
BEGIN
 FOR c IN SELECT cl.oid,cl.relname,cl.relkind,n.nspname FROM pg_class cl JOIN pg_namespace n ON n.oid=cl.relnamespace WHERE cl.relkind IN ('r','p','v','m','f','S') AND n.nspname NOT LIKE 'pg_%%' AND n.nspname <> 'information_schema' LOOP
  IF c.relkind='S' THEN
   IF has_sequence_privilege('widya_reader',c.oid,'USAGE,SELECT,UPDATE') THEN RAISE EXCEPTION 'reader sequence privilege'; END IF;
   CONTINUE;
  END IF;
  IF has_table_privilege('widya_reader',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'reader table privilege'; END IF;
  FOR a IN SELECT attname,attnum FROM pg_attribute WHERE attrelid=c.oid AND attnum>0 AND NOT attisdropped LOOP
   wanted := c.nspname='public' AND coalesce((expected->c.relname) ? a.attname,false);
   IF has_column_privilege('widya_reader',c.oid,a.attnum,'INSERT,UPDATE,REFERENCES') THEN RAISE EXCEPTION 'reader column write privilege'; END IF;
   IF has_column_privilege('widya_reader',c.oid,a.attnum,'SELECT') AND NOT wanted THEN RAISE EXCEPTION 'reader unexpected column'; END IF;
   IF %s AND wanted AND NOT has_column_privilege('widya_reader',c.oid,a.attnum,'SELECT') THEN RAISE EXCEPTION 'reader expected column missing'; END IF;
  END LOOP;
 END LOOP;
END $audit$;
""" % (allowed, require)


LAUNCHER = '''#!/bin/sh
set -eu
cd /
exec /usr/bin/sudo -n -u widya_reader -- /usr/bin/env -i PATH=/usr/bin:/bin HOME=/nonexistent TZ=UTC /usr/local/bin/node /opt/sipeka/current/scripts/widya-dashboard-read.cjs "$@"
'''
SUDOERS = '''# Fixed private Widya reader only; JSON is parsed as one script argument.
ubuntu ALL=(widya_reader) NOPASSWD: /usr/bin/env -i PATH=/usr/bin\\:/bin HOME=/nonexistent TZ=UTC /usr/local/bin/node /opt/sipeka/current/scripts/widya-dashboard-read.cjs *
'''


def install(path, content, mode):
    path = Path(path)
    fd, name = tempfile.mkstemp(prefix='.widya-reader-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as out:
            out.write(content)
        os.chmod(name, mode)
        os.chown(name, 0, 0)
        if path.parent == Path('/etc/sudoers.d'):
            subprocess.run(['/usr/sbin/visudo', '-cf', name], check=True, capture_output=True)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def check_file(path, content, mode):
    path = Path(path)
    stat = path.stat()
    if stat.st_uid != 0 or stat.st_mode & 0o777 != mode or path.read_text() != content:
        raise RuntimeError('WIDYA_READER_INSTALLATION_MISMATCH')


def allow_code_read():
    """Traverse the release but read only the four helper source files and npm.

    Never recurse through the app release, uploads, generated files or /etc.
    The node_modules symlink is resolved and constrained to /opt/sipeka.
    """
    files = [APP/'widya-dashboard-reader.js', APP/'scripts/widya-dashboard-read.cjs', APP/'informational-statements.js', APP/'operational-reports.js']
    modules = (APP/'node_modules').resolve(strict=True)
    base = Path('/opt/sipeka')
    if base not in modules.parents or not modules.is_dir():
        raise RuntimeError('WIDYA_READER_UNEXPECTED_MODULE_PATH')
    ancestors = set()
    for target in [f.resolve(strict=True) for f in files] + [modules]:
        if base not in target.parents:
            raise RuntimeError('WIDYA_READER_UNEXPECTED_RELEASE_PATH')
        for parent in target.parents:
            if parent == Path('/opt'):
                break
            if parent.stat().st_uid != 0 or parent.stat().st_mode & 0o022:
                raise RuntimeError('WIDYA_READER_CODE_PARENT_MUST_BE_ROOT_OWNED')
            ancestors.add(str(parent))
    subprocess.run(['/usr/bin/setfacl', '-m', 'u:widya_reader:--x', *sorted(ancestors)], check=True, capture_output=True)
    subprocess.run(['/usr/bin/setfacl', '-m', 'u:widya_reader:r--', *[str(f.resolve()) for f in files]], check=True, capture_output=True)
    subprocess.run(['/usr/bin/setfacl', '-R', '-P', '-m', 'u:widya_reader:rX', str(modules)], check=True, capture_output=True)


def main():
    import pwd
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if args.apply == args.check or os.geteuid() != 0:
        parser.error('run as root with exactly one of --check / --apply')
    for file in [APP/'widya-dashboard-reader.js', APP/'scripts/widya-dashboard-read.cjs', APP/'informational-statements.js', APP/'operational-reports.js']:
        if not file.is_file() or file.stat().st_uid != 0 or file.stat().st_mode & 0o022:
            raise RuntimeError('WIDYA_READER_RELEASE_MUST_BE_ROOT_OWNED')
    exists = psql("SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='widya_reader');") == 't'
    if exists:
        psql(role_audit_sql() + privilege_audit_sql())
    elif not args.apply:
        raise RuntimeError('WIDYA_READER_NOT_PROVISIONED')
    if args.apply:
        grants = '\n'.join('GRANT SELECT (%s) ON public.%s TO widya_reader;' % (','.join(columns), table) for table, columns in GRANTS.items())
        create = '' if exists else 'CREATE ROLE widya_reader LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;'
        psql('BEGIN;\n' + create + '\nALTER ROLE widya_reader SET default_transaction_read_only=on;\nALTER ROLE widya_reader SET search_path=pg_catalog,public;\nGRANT CONNECT ON DATABASE sipeka TO widya_reader;\nGRANT USAGE ON SCHEMA public TO widya_reader;\n' + grants + '\n' + role_audit_sql() + privilege_audit_sql(True) + '\nCOMMIT;')
        try:
            pwd.getpwnam(ROLE)
        except KeyError:
            subprocess.run(['/usr/sbin/useradd', '--system', '--no-create-home', '--home-dir', '/nonexistent', '--shell', '/usr/sbin/nologin', ROLE], check=True, capture_output=True)
        allow_code_read()
        install('/usr/local/bin/widya-dashboard-read', LAUNCHER, 0o755)
        install('/etc/sudoers.d/widya-dashboard-reader', SUDOERS, 0o440)
    identity = pwd.getpwnam(ROLE)
    if identity.pw_uid == 0 or identity.pw_shell not in ('/usr/sbin/nologin', '/sbin/nologin') or identity.pw_dir != '/nonexistent':
        raise RuntimeError('WIDYA_READER_UNEXPECTED_OS_IDENTITY')
    if os.getgrouplist(ROLE, identity.pw_gid) != [identity.pw_gid]:
        raise RuntimeError('WIDYA_READER_UNEXPECTED_OS_GROUPS')
    psql(role_audit_sql() + privilege_audit_sql(True))
    check_file('/usr/local/bin/widya-dashboard-read', LAUNCHER, 0o755)
    check_file('/etc/sudoers.d/widya-dashboard-reader', SUDOERS, 0o440)
    # Enforce peer auth and role defaults without reading transaction records.
    result = subprocess.run(['/usr/sbin/runuser', '-u', ROLE, '--', '/usr/bin/env', '-i', 'PATH=/usr/bin:/bin', 'HOME=/nonexistent', '/usr/bin/psql', '-X', '-qAt', '-h', '/var/run/postgresql', '-U', ROLE, '-d', DATABASE, '-c', "SELECT current_user||':'||current_setting('default_transaction_read_only')"], capture_output=True, text=True)
    if result.returncode or result.stdout.strip() != 'widya_reader:on':
        raise RuntimeError('WIDYA_READER_PEER_AUTH_CHECK_FAILED')
    print(json.dumps({'ok': True, 'role': ROLE, 'mode': 'apply' if args.apply else 'check', 'tables': len(GRANTS), 'credential_file': False}))


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, subprocess.SubprocessError, OSError) as exc:
        code = str(exc) if str(exc).startswith('WIDYA_READER_') else 'WIDYA_READER_PROVISION_FAILED'
        print(json.dumps({'ok': False, 'error': code}))
        raise SystemExit(1)
