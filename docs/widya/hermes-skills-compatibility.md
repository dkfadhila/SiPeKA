# Hermes skill enumeration compatibility repair

Read-only production audit on 28 October 2026 found a reproducible HTTP 500 at
authenticated `/p/widya/v1/skills`. Hermes `api_server.py::_handle_skills` passes
`include_editorial=True`, while the installed `tools.skills_tool._find_all_skills`
accepts only `skip_disabled`. The server logs report `TypeError: unexpected
keyword argument 'include_editorial'`. Model/capabilities endpoints and both
API/Telegram gateway platform health remain available; this bug alone does not
prove every tool call or Telegram reply is broken.

The dashboard reader itself was verified separately as the Hermes `ubuntu`
identity: branch master read succeeds, and an October 1–28 WIB financial summary
returns the actual source records. No business records, gateway sessions or
Telegram messages were created during this audit. Existing gateway logs contain
an older terminal-tool warning but truncate its content before the failure
diagnostic; its underlying cause remains unverified.

## Narrow repair

After pushing this tested source and deploying its release, as root run:

```sh
python3 /opt/sipeka/current/scripts/patch-widya-hermes-skills.py --check
python3 /opt/sipeka/current/scripts/patch-widya-hermes-skills.py --apply
```

The installer checks the exact deployed Hermes source paths, expected handler
body, catalog function signature, source ownership and symlink absence. It saves
the original source to root-only `/var/backups/sipeka-hermes-skills/` using its
SHA-256 as the filename. It compiles the patched source before atomically
replacing the original while preserving ownership/mode. It never imports the
Hermes runtime, changes config/SOUL/AGENTS/skills, or restarts a service.

The patch passes `include_editorial` only if the actual catalog signature
supports it; `skip_disabled=False` and the existing deterministic sort remain
unchanged. Repeated application is idempotent. An upstream source change causes
the installer to refuse rather than guessing at another patch location.

A running Python process may retain the old imported handler. Coordinate one
restart of the actual Widya gateway only after checking there are no active
runs, then verify the authenticated skills endpoint returns HTTP 200 and includes
`sipeka-dashboard-reader`. Do not print bearer keys or private skill contents to
deployment logs. Models/capabilities health checks alone do not verify this fix.

For rollback, restore the exact hash-addressed backup to the original path,
preserving its ownership/mode, then coordinate the same gateway restart.

## Verification

```sh
node --test tests/widya-hermes-skills-patch.test.js tests/widya-dashboard-reader.test.js
```

The compatibility fixture executes the patched async handler against both old
and new function signatures, validates sorting, rejects unexpected source and
checks idempotence. It does not contact the live gateway or send messages.
