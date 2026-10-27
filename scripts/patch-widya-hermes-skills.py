#!/usr/bin/env python3
"""Narrow compatibility repair for Hermes GET /v1/skills; no service restart.

Use --check to inspect, --apply to save an immutable source backup and patch.
Only the confirmed Widya Hermes path is accepted. No config/identity is changed.
"""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import tempfile

TARGET = Path('/home/ubuntu/.hermes/hermes-agent/gateway/platforms/api_server.py')
TOOL = Path('/home/ubuntu/.hermes/hermes-agent/tools/skills_tool.py')
OLD = '''            skills = _sort_skills(
                _find_all_skills(
                    skip_disabled=False, include_editorial=True
                )
            )'''
NEW = '''            # SIPEKA_SKILLS_SIGNATURE_COMPAT_V1: support old/new Hermes catalogs.
            import inspect
            catalog_parameters = inspect.signature(_find_all_skills).parameters
            catalog_options = {"skip_disabled": False}
            if "include_editorial" in catalog_parameters:
                catalog_options["include_editorial"] = True
            skills = _sort_skills(_find_all_skills(**catalog_options))'''


def patch_source(source):
    tree = ast.parse(source)
    handlers = [n for n in ast.walk(tree) if isinstance(n, ast.AsyncFunctionDef) and n.name == '_handle_skills']
    if len(handlers) != 1:
        raise ValueError('HERMES_SKILLS_UNEXPECTED_HANDLER')
    lines = source.splitlines(keepends=True)
    handler = ''.join(lines[handlers[0].lineno-1:handlers[0].end_lineno])
    if NEW in handler:
        return source, False
    if handler.count(OLD) != 1 or source.count(OLD) != 1:
        raise ValueError('HERMES_SKILLS_UNEXPECTED_SOURCE')
    result = source.replace(OLD, NEW, 1)
    compile(result, str(TARGET), 'exec')
    return result, True


def signature(source):
    tree = ast.parse(source)
    funcs = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == '_find_all_skills']
    if len(funcs) != 1 or 'skip_disabled' not in [a.arg for a in funcs[0].args.kwonlyargs + funcs[0].args.args]:
        raise ValueError('HERMES_SKILLS_UNEXPECTED_CATALOG_SIGNATURE')
    return [a.arg for a in funcs[0].args.kwonlyargs + funcs[0].args.args]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--check', action='store_true')
    group.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise ValueError('HERMES_SKILLS_ROOT_REQUIRED')
    for file in (TARGET, TOOL):
        if file.is_symlink() or not file.is_file() or file.resolve() != file:
            raise ValueError('HERMES_SKILLS_UNEXPECTED_TARGET')
    stat = TARGET.stat()
    # The deployment currently owns Hermes sources as ubuntu; do not alter it.
    import pwd
    if stat.st_uid != pwd.getpwnam('ubuntu').pw_uid or stat.st_mode & 0o002:
        raise ValueError('HERMES_SKILLS_UNEXPECTED_OWNER')
    original = TARGET.read_bytes()
    source = original.decode('utf-8')
    patched, changed = patch_source(source)
    parameters = signature(TOOL.read_text(encoding='utf-8'))
    digest = hashlib.sha256(original).hexdigest()
    if args.apply and changed:
        backup_dir = Path('/var/backups/sipeka-hermes-skills')
        backup_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        if backup_dir.is_symlink() or backup_dir.stat().st_uid != 0 or backup_dir.stat().st_mode & 0o077:
            raise ValueError('HERMES_SKILLS_UNSAFE_BACKUP_DIR')
        backup = backup_dir / ('api_server.' + digest + '.py')
        try:
            with backup.open('xb') as out:
                out.write(original)
            os.chmod(backup, 0o600)
        except FileExistsError:
            if backup.is_symlink() or backup.read_bytes() != original:
                raise ValueError('HERMES_SKILLS_BACKUP_CONFLICT')
        fd, temp = tempfile.mkstemp(prefix='.sipeka-skills-', dir=TARGET.parent)
        try:
            with os.fdopen(fd, 'wb') as out:
                out.write(patched.encode('utf-8'))
                out.flush()
                os.fsync(out.fileno())
            os.chown(temp, stat.st_uid, stat.st_gid)
            os.chmod(temp, stat.st_mode & 0o777)
            if TARGET.read_bytes() != original:
                raise ValueError('HERMES_SKILLS_SOURCE_CHANGED')
            os.replace(temp, TARGET)
        finally:
            if os.path.exists(temp):
                os.unlink(temp)
    print(json.dumps({'ok': True, 'mode': 'apply' if args.apply else 'check', 'patch_needed': changed, 'patched': not changed or args.apply, 'catalog_parameters': parameters, 'source_sha256': digest, 'restart_required': bool(args.apply and changed)}))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, SyntaxError, UnicodeError) as exc:
        code = str(exc) if str(exc).startswith('HERMES_SKILLS_') else 'HERMES_SKILLS_PATCH_FAILED'
        print(json.dumps({'ok': False, 'error': code}))
        raise SystemExit(1)
