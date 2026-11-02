# Widya Telegram native file delivery — 2 November 2026

The reviewed gateway is the Ubuntu **user** unit `hermes-gateway.service`, multiplexing the default API endpoint and the Widya Telegram profile. It is not a root system `widya.service`. Profile `/home/ubuntu/.hermes/profiles/widya`; terminal cwd `/home/ubuntu/FamilyAgent/Widya/workspace`; native Telegram preset `hermes-telegram` supplies terminal/file/skills support. The historical pause plugin was already disabled; this repair does not activate a previously paused plugin or grant root permissions.

Native attachment replies use a real, existing file plus a final `MEDIA:/absolute/path/file.ext` outside fenced code, inline code, blockquotes or serialized JSON. A bare promise is not delivery. Native Hermes intentionally no longer exposes `send_message` as a model tool. The operator CLI `hermes send` reuses the supported media parser, media policy and platform sender; `--file` reads a message body and is not an attachment option.

The dashboard delivery helper remains separate and session-bound: `/usr/local/bin/widya-telegram-send` only accepts files directly under `/var/lib/sipeka/widya-files/<session_uuid>/outputs/`. Passing a Telegram-generated file to that helper is refused by design. Do not bypass this by moving private uploads across sessions.

## Narrow configuration and context repair

`scripts/setup-widya-telegram-context.py --apply` installs:

- Native output allowlist `/home/ubuntu/FamilyAgent/Widya/generated/telegram-outbox/`, mode 0700, Ubuntu-owned. It does not allow the whole home directory, release tree or generated directory.
- `gateway.strict: true` and `gateway.trust_recent_files: false`. Existing Hermes supported cache roots remain native behavior; no vendor code is edited.
- Read-only `pre_llm_call` hook with identity plus current integration context. The hook is bound to the deployed exact model `kr/gpt-5.6-luna`; if the model changes, review the hook predicate. It reads no secrets, invokes no send, and does not change LLM output.
- Updated delivery skill describing native same-chat replies and the session-bound dashboard helper.

The installer preserves original config formatting except three exact media-policy lines, validates YAML/AST, refuses unexpected layouts/symlinks, backs up each changed file with SHA-256 manifest under `/var/backups/sipeka-widya-telegram-context/<UTC stamp>/`, writes atomically, and reports whether a restart is required. It never restarts a service itself. `--check` is read-only; repeating apply/check after installation reports `changed_files: []`.

Do not alter `drop_pending_on_cold_boot`. The existing true/default discards pending Telegram updates on a cold boot; watcher reconnects preserve them. A gateway restart must be coordinated with active runs and this queue behavior disclosed. This repair leaves the setting unchanged.

## Verification and scope

On 2 November 2026, native validation accepted a harmless TXT in the output directory and rejected profile `.env`, SSH authorization path, `/etc/passwd`, and a workspace AGENTS file outside the allowlist. After an idle coordinated gateway restart, the API and Widya Telegram reported connected and Telegram polling logged progressing. The read-only dashboard reader reported `read_only: true` with source/observed_at and explicit unavailable payroll/accounting/contact capabilities.

One explicitly authorized 81-byte TXT was sent to the verified Radit private chat via native Hermes CLI `send --json`, using `MEDIA:`. The result reported success, chat `1263563064`, message ID `243`, SHA-256 `e8ece19642a202d70ed97dc6beb6f5f7c9c981ffaa9e9eb463a5e7708aed3595`. It contained no employee or financial data. This proves native transport acceptance; it does not prove recipient read status, every future LLM chooses the correct delivery directive, or AI payroll correctness. No duplicate was sent, no Tirta test was sent, and no real payroll/email was sent.

## Rollback

The initial repair backup is `/var/backups/sipeka-widya-telegram-context/20261102T085025075820Z`. Read its root-only manifest before rollback. To restore the three pre-existing targets without printing their contents:

```sh
sudo python3 - <<'PY'
import json, os, shutil
from pathlib import Path
backup = Path('/var/backups/sipeka-widya-telegram-context/20261102T085025075820Z')
profile = Path('/home/ubuntu/.hermes/profiles/widya')
for row in json.loads((backup / 'manifest.json').read_text()):
    target = Path(row['target'])
    assert target.is_relative_to(profile) and not target.is_symlink()
    if row['backup'] is not None:
        shutil.copyfile(backup / row['backup'], target)
        os.chown(target, 1000, 1000)
        os.chmod(target, 0o600)
    elif target.exists():
        # Preserve newly installed context rather than deleting it.
        target.rename(backup / ('disabled-' + target.name))
print('Widya context/media files restored; restart only the gateway after an idle check.')
PY
sudo -u ubuntu env XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus systemctl --user restart hermes-gateway.service
```

Retain generated files and receipts. Do not reset Telegram offsets or delivery state to rerun a message. Check gateway status/polling after rollback. No firewall, SSH, database ACL, reader mutation or email-provider changes are part of this repair.
