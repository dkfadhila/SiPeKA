#!/usr/bin/env python3
"""Install documented Widya file-delivery context and narrow native media policy.

Root-only explicit installer. No restart, send, DB mutation, secret loading or permission broadening.
"""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import pwd
import shutil
import tempfile
from datetime import datetime, timezone

PROFILE = Path('/home/ubuntu/.hermes/profiles/widya')
OUTPUT = Path('/home/ubuntu/FamilyAgent/Widya/generated/telegram-outbox')
BACKUPS = Path('/var/backups/sipeka-widya-telegram-context')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def atomic(file, data, uid, gid, mode=0o600):
    if file.is_symlink():
        raise ValueError('WIDYA_CONTEXT_UNSAFE_PATH')
    fd, temp = tempfile.mkstemp(prefix='.widya-context-', dir=file.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chown(temp, uid, gid)
        os.chmod(temp, mode)
        os.replace(temp, file)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', default='/opt/sipeka/current')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if os.geteuid() != 0 or args.apply == args.check:
        raise ValueError('WIDYA_CONTEXT_ROOT_EXPLICIT_MODE_REQUIRED')
    source = Path(args.source).resolve(strict=True)
    if not (source == Path('/opt/sipeka/current').resolve() or source.is_relative_to('/var/lib/sipeka/release-evidence')):
        raise ValueError('WIDYA_CONTEXT_SOURCE_DENIED')
    import yaml
    user = pwd.getpwnam('ubuntu')
    config = PROFILE / 'config.yaml'
    original = config.read_text()
    changes = [
        ('  strict: false', '  strict: true'),
        ('  media_delivery_allow_dirs: []', '  media_delivery_allow_dirs: ["' + str(OUTPUT) + '"]'),
        ('  trust_recent_files: true', '  trust_recent_files: false'),
    ]
    proposed = original
    for old, new in changes:
        if new in proposed:
            continue
        if proposed.count(old) != 1:
            raise ValueError('WIDYA_CONTEXT_UNEXPECTED_MEDIA_CONFIG')
        proposed = proposed.replace(old, new, 1)
    parsed = yaml.safe_load(proposed)
    gateway = parsed.get('gateway', {})
    if gateway.get('strict') is not True or gateway.get('trust_recent_files') is not False or gateway.get('media_delivery_allow_dirs') != [str(OUTPUT)]:
        raise ValueError('WIDYA_CONTEXT_MEDIA_CONFIG_INVALID')
    if parsed.get('platforms', {}).get('telegram', {}).get('enabled') is not True:
        raise ValueError('WIDYA_CONTEXT_TELEGRAM_NOT_ENABLED')
    files = {
        config: proposed.encode(),
        PROFILE / 'hooks/application_context.py': (source / 'docs/widya/application_context.py').read_bytes(),
        PROFILE / 'OPERATING_CONTEXT.md': (source / 'docs/widya/OPERATING_CONTEXT.md').read_bytes(),
        PROFILE / 'skills/sipeka-telegram-delivery/SKILL.md': (source / 'docs/widya/telegram-delivery/SKILL.md').read_bytes(),
    }
    ast.parse(files[PROFILE / 'hooks/application_context.py'])
    for file in files:
        if file.is_symlink() or file.parent.is_symlink():
            raise ValueError('WIDYA_CONTEXT_UNSAFE_PATH')
    changed = {file: data for file, data in files.items() if not file.exists() or file.read_bytes() != data}
    backup = None
    if args.apply and changed:
        BACKUPS.mkdir(parents=True, exist_ok=True, mode=0o700)
        backup = BACKUPS / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        backup.mkdir(mode=0o700)
        manifest = []
        for index, (file, data) in enumerate(changed.items()):
            previous = file.read_bytes() if file.exists() else None
            if previous is not None:
                shutil.copy2(file, backup / str(index))
                os.chmod(backup / str(index), 0o600)
            manifest.append({'target': str(file), 'backup': str(index) if previous is not None else None, 'before_sha256': digest(previous) if previous is not None else None, 'after_sha256': digest(data)})
        (backup / 'manifest.json').write_text(json.dumps(manifest, indent=2))
        os.chmod(backup / 'manifest.json', 0o600)
        for file, data in changed.items():
            atomic(file, data, user.pw_uid, user.pw_gid)
        OUTPUT.mkdir(mode=0o700, exist_ok=True)
        if OUTPUT.is_symlink():
            raise ValueError('WIDYA_CONTEXT_UNSAFE_PATH')
        os.chown(OUTPUT, user.pw_uid, user.pw_gid)
        os.chmod(OUTPUT, 0o700)
    print(json.dumps({'ok': True, 'mode': 'apply' if args.apply else 'check', 'changed_files': [str(p) for p in changed], 'backup': str(backup) if backup else None, 'native_generated_output': str(OUTPUT), 'strict_media': True, 'trust_recent_files': False, 'restart_required': config in changed, 'messages_sent': 0}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'error': str(error) if str(error).startswith('WIDYA_CONTEXT_') else 'WIDYA_CONTEXT_SETUP_FAILED'}))
        raise SystemExit(1)
