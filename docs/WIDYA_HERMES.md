# Widya website integration

Owner chat uses the documented Hermes gateway API, not `hermes proxy` (inference-only) or `hermes serve` (desktop JSON-RPC). No direct-model fallback. OCR remains separately configured/deferred.

## Private server configuration

Set SiPeKA service environment, never browser or Git:

- `WIDYA_HERMES_URL=http://127.0.0.1:8642/p/widya`
- `WIDYA_HERMES_KEY`: copy privately from named profile `API_SERVER_KEY`; at least 32 characters. Do not use the default profile key.

Gateway default and Widya profile require `API_SERVER_KEY` in private `.env`, `API_SERVER_ENABLED=true`, supported `hermes [--profile widya] config set platforms.api_server.enabled true`, `platforms.api_server.extra.host 127.0.0.1`, `platforms.api_server.extra.port 8642`. Multiplex routing is already enabled on this host. Gateway restart activates changes. No nginx route, public port or browser CORS needed. For local development on another machine, use an SSH loopback tunnel; never expose the Hermes listener publicly.

The bridge supplies no model/provider override. Widya configuration resolves `custom`, exact model `kr/gpt-5.6-luna`, internal inference `http://127.0.0.1:20129/v1`; existing SOUL, workspace, hooks, skills and tools remain active. Telegram uses the same named profile, separate histories.

## Durable dashboard sessions and files (migration 016)

The Owner dashboard uses `GET/POST /api/widya/sessions`, `GET /api/widya/sessions/:id`, and `POST /api/widya/sessions/:id/messages`. Sessions, user/assistant messages, exact admission payload, client message idempotency key, Hermes run ID and attachment bytes live in PostgreSQL. They survive reload, logout, a new login and service restart. There is no delete endpoint or automatic retention sweep. Existing histories from the former browser-only UI cannot be reconstructed automatically; Hermes retains those historical transcripts separately.

Session IDs and Hermes conversation IDs are generated server-side and scoped to the authenticated Owner. The stable Hermes ID does not contain a login token. The browser cannot select a raw Hermes/Telegram history, supply system instructions, previous messages, provider, tools or profile overrides. Staff are denied. All access functions check current full Owner sessions; file IDs are additionally scoped through their parent session. Runtime has no direct table permissions; SECURITY DEFINER functions have fixed schema search paths and PUBLIC execution revoked.

Sends return 202 after the user message and queue record commit. The worker admits at most two live website runs and persists the exact request before upstream creation. Hermes `/v1/capabilities` must advertise durable idempotency before admission. Recovered `starting` requests use the same upstream key and the same persisted request, for at most 15 minutes from first preparation; admission remaining unknown becomes `uncertain` and requires operator review. It never starts a replacement run. Known run IDs are polled after restart, and terminal responses are stored exactly once. No HTTP disconnect cancels a queued task. `POST /sessions/:id/stop {}` records cancellation and calls the supported `/v1/runs/:run_id/stop`; history stays intact.

Actual installed Hermes source loads `_conversation_history_for_session` for repeated explicit session IDs, resolves live tips after compression, and executes configured profile tools server-side. No model/provider override or direct-model fallback is sent. Telegram uses the same named Widya profile and separate conversations. Profile-level memory and tools remain shared with Widya; a single profile is not an OS security boundary between Owners. Prompts and path checks constrain website file delivery but do not sandbox Hermes terminal access.

Pending Hermes approvals persist with their exact request ID and redacted command. The dashboard can explicitly approve once or deny using `POST /sessions/:id/approval {request_id,choice}`. It forwards only those choices present in the upstream request. It cannot approve automatically, approve the entire session, approve forever, or resolve all requests. The existing mandate requiring an explicit second confirmation for deletion remains binding. The bridge permits requested topics and configured tools beyond financial advice; this does not invent business write APIs or override their existing authorizations.

Uploads use `POST /sessions/:id/files {name,mime,data_base64}`; each file is at most 10 MiB, four per message. Authoritative bytes remain in PostgreSQL and are covered by database backups. `GET /api/widya/files/:id` always checks authenticated Owner ownership and serves an attachment with `nosniff`, sandbox CSP and private/no-store caching. Unsupported native Hermes document uploads are not invented: the worker materializes approved upload bytes as local files for the configured Hermes file tools.

Configure `WIDYA_FILES_DIR=/var/lib/sipeka/widya-files` in the private service environment. Install Ubuntu `acl`. Base directory is `sipeka:sipeka`, mode0750 with `ubuntu:--x`; `/var/lib/sipeka` also grants Ubuntu traversal only. The service creates private session directories with Ubuntu traversal, read-only input directories/files, and an output directory writable by Ubuntu. Output default ACL additionally grants the SiPeKA service UID read access to generated files. No gateway restart or broad shared group is needed. The service must retain write access under systemd `ReadWritePaths=/var/lib/sipeka`.

The worker tells Hermes its session output directory and imports only explicitly referenced `MEDIA:"/absolute/path"` files directly inside that canonical directory. It rejects symlinks, nonregular files, hardlinks and files over10 MiB; sibling sessions and arbitrary host paths never become downloads. Generated downloads are copied into the database before becoming visible. File names render as text and downloads are forced attachments. Removing filesystem caches does not remove retained download bytes; previous local input paths may need re-materialization by an operator if their cache was externally deleted.

Legacy `POST /api/widya` and `/api/dewi` remain compatibility routes; those browser UUID histories retain the old login-scoped HMAC mapping. New UI sessions exclusively use the durable APIs. Status remains Owner-only and exposes readiness without credentials. Existing latest40 ledger context is labelled as an excerpt; full-period data requires Widya's configured authorized business reader.

## Verification

- `node --test tests/widya-bridge.test.js tests/widya-browser.test.js tests/widya-sessions.test.js`
- `node tests/widya-sessions-postgres-vps.cjs` (isolated retained QA schema on VPS; synthetic rows only)
- `node --test tests/server-postgres-http.js` (isolated asynchronous SQLite DB contract harness, not real PostgreSQL)
- `node --test tests/*.test.js`

Actual VPS bridge verification artifact: `D:/FamilyAgent/Flora/generated/widya-vps/ai-integration/real-bridge-result.txt`. Authenticated profile discovery succeeded; unauthenticated request returned 401; actual agent identified as Widya Head of Accounting and reported workspace via requested terminal `pwd`, runtime `custom/kr/gpt-5.6-luna`. Separate probe conversation, no financial writes.

Historical bridge rollout: commit `a1f6312` originally left deployment paused. The current durable-session release supersedes that rollout note; its release record and runtime verification determine the deployed state. Apply migration016 as the existing `sipeka_app` schema owner so scheduled `sipeka_app` database backups retain new message/file tables, then verify Owner chat, Staff denial, cancellation, actual runtime and backup read access.

## Owner operational mandate and active monitoring

Canonical identity mirrors: `docs/widya/SOUL.md` and `docs/widya/AGENTS.md`, deployed to `/home/ubuntu/.hermes/profiles/widya/SOUL.md` and `/home/ubuntu/FamilyAgent/Widya/workspace/AGENTS.md`. Preserve `hooks/application_context.py`, custom `kr/gpt-5.6-luna`, local 9Router and existing private tokens.

Every deletion requires a second explicit warning after the initial request, then a new explicit Owner confirmation. Name exact target, permanence, dependencies, risks and alternatives. DB deletion additionally requires a DB-specific Owner request. Archive also requires explicit confirmation; financial/audit retention remains binding. Requested reports, reconciliation, financial audit, evidenced balances, PDF/CSV exports and user/branch create/rename/archive use authorized business tools; no claim of connected write APIs or unrestricted authority. The website bridge invokes configured Hermes tools subject to the Owner mandate; it does not itself add a financial write API.

Supported persistent Hermes cron, named profile `widya`:

- Job `ebe2ca88af83`, `0 6,18 * * *`, timezone `Asia/Jakarta`: only 06:00 and 18:00 WIB daily; unlimited recurrence.
- Private delivery and failure notice: `telegram:1122048904`. Active shared `hermes-gateway.service` executes the profile scheduler.
- Deterministic `--no-agent` script `/home/ubuntu/.hermes/profiles/widya/scripts/widya_monitor.py`; versioned source `docs/widya/widya_monitor.py`. No inference dependency or provider changes. Project workdir is the Widya workspace.
- Read-only website `/`, `/api/health`, `/api/ready`, DB query inside `BEGIN READ ONLY` with statement timeout, disk/gateway state, daily PostgreSQL/receipt and VPS backup result/timestamp, sanitized R2/Supabase acceptance evidence. No payroll PII, financial writes, service restarts or SiPeKA deploy.
- At 18:00, add the latest-24-hour summary from locally retained monitoring samples. First day is explicitly partial coverage; point-in-time sampling is not continuous monitoring or a full financial statement. No balance/accrual claims from record counts.
- Runtime evidence: `/home/ubuntu/.hermes/profiles/widya/monitoring/{samples.jsonl,latest.txt,telegram-proof.json}`; local installation/probe artifacts `D:/FamilyAgent/Flora/generated/widya-vps/monitoring/`.

Actual 2026-10-07 02:02 WIB verification: website/health/readiness/DB OK; gateway active; disk 17.3%; ledger count 0, branch count 6 (not a cash balance). PostgreSQL/receipt backup completed 02:00:09 WIB with R2/Supabase API acceptance; VPS backup completed 2026-10-06 03:24:12 WIB, offsite verification unavailable from its last-24-hour journal. Manual job run succeeded, Telegram API returned message ID `9`; device delivery/read status remains unverified. Job list readback confirmed active recurrence and next run `2026-10-07T06:00:00+07:00`.

An initial probe used urllib's default User-Agent and falsely reported HTTP failures behind the website filter. Corrected explicit User-Agent; rerun returned all website checks OK and sent the corrected report. Existing historical samples retain that probe failure for audit.

2026-10-08 cadence correction: supported CLI edited the existing job to `0 6,18 * * *`; profile timezone readback `Asia/Jakarta`, next run `2026-10-08T18:00:00+07:00`. Script/no-agent mode, private Owner delivery, model configuration and other jobs unchanged. Runtime SOUL/AGENTS/script match the canonical mirrors. Actual live read-only checks passed; isolated-state 06:00/18:00 clock-path tests confirmed the daily recap only at 18:00. Clock overrides test rendering, not historical service health. Production monitoring history/latest report were unchanged; no Telegram test send. Evidence: `D:/FamilyAgent/Flora/generated/widya-vps/monitoring-2x/`. PostgreSQL/receipt offsite targets accepted; VPS backup offsite verification still unavailable from its 24-hour journal.

Commands: `/home/ubuntu/.local/bin/hermes --profile widya cron list`, `cron runs ebe2ca88af83`, `cron run ebe2ca88af83` (sends a real private report). Configure timezone with supported `hermes --profile widya config set timezone Asia/Jakarta`; do not hand-edit cron/config storage.

References: https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server and https://hermes-agent.nousresearch.com/docs/developer-guide/programmatic-integration . VPS inspected source revision `765342435`.
