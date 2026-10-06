# Widya website integration

Owner chat uses the documented Hermes gateway API, not `hermes proxy` (inference-only) or `hermes serve` (desktop JSON-RPC). No direct-model fallback. OCR remains separately configured/deferred.

## Private server configuration

Set SiPeKA service environment, never browser or Git:

- `WIDYA_HERMES_URL=http://127.0.0.1:8642/p/widya`
- `WIDYA_HERMES_KEY`: copy privately from named profile `API_SERVER_KEY`; at least 32 characters. Do not use the default profile key.

Gateway default and Widya profile require `API_SERVER_KEY` in private `.env`, `API_SERVER_ENABLED=true`, supported `hermes [--profile widya] config set platforms.api_server.enabled true`, `platforms.api_server.extra.host 127.0.0.1`, `platforms.api_server.extra.port 8642`. Multiplex routing is already enabled on this host. Gateway restart activates changes. No nginx route, public port or browser CORS needed. For local development on another machine, use an SSH loopback tunnel; never expose the Hermes listener publicly.

The bridge supplies no model/provider override. Widya configuration resolves `custom`, exact model `kr/gpt-5.6-luna`, internal inference `http://127.0.0.1:20129/v1`; existing SOUL, workspace, hooks, skills and tools remain active. Telegram uses the same named profile, separate histories.

## Wire and isolation

`GET /api/widya/status` Owner-only, authenticated `/v1/models` readiness; explicitly reports unavailable configuration. `POST /api/widya` accepts only `{message, conversation_id}` (UUID v4, text limit 8000). `/api/dewi` retained as route alias, not historical client-supplied message arrays. Backend injects a labelled latest-40 ledger excerpt. No complete-period claims. Financial query tooling belongs to the configured Widya profile, not an impersonated web Owner token.

Backend session IDs are HMAC-derived from authenticated user, login session token and conversation UUID. Browser cannot select a raw Hermes/Telegram session, supply system roles, previous response IDs, provider, tools or profile. Histories stay in profile storage; logout starts a fresh UUID, aborts pending fetch, clears rendered chat. Profile-level memory intentionally remains shared with Widya; only authenticated Owners can access this surface. This is not separate profiles per Owner.

Max two admitted website turns, one per conversation, immediate `429 WIDYA_BUSY` (no unbounded queue). Deadline 180 seconds. Cancellation/timeout asks Hermes `/stop`; active reservations remain until Hermes confirms a terminal worker state. An unknown admission outcome fails closed and retains its reservation; recover by operator review/restart, never duplicate a potentially executing agent action. Runs are not silently replayed. Approval requests stop the turn with `WIDYA_APPROVAL_REQUIRED`; no web auto-approval endpoint.

This surface requests read-only advisory operation and provides no financial write API or Owner credentials. **Prompt instructions are not a sandbox:** Widya retains its profile tools, including terminal. If strict hard isolation against an authorized Owner requesting arbitrary host actions is required, deploy OS/database least-privilege restrictions or a restricted tool profile before enabling chat. Do not claim prompt rules prevent all writes. Global profile memory/session-search tools can inspect profile history; no claim of cryptographic isolation from Widya itself.

Replies render as text, not HTML. Errors never relay raw provider output or credentials. Existing cookie/RBAC/Origin CSRF gates precede chat admission; session is revalidated before returning the reply.

## Verification

- `node --test tests/widya-bridge.test.js tests/widya-browser.test.js`
- `node --test tests/server-postgres-http.js` (isolated asynchronous SQLite DB contract harness, not real PostgreSQL)
- `node --test tests/*.test.js`

Actual VPS bridge verification artifact: `D:/FamilyAgent/Flora/generated/widya-vps/ai-integration/real-bridge-result.txt`. Authenticated profile discovery succeeded; unauthenticated request returned 401; actual agent identified as Widya Head of Accounting and reported workspace via requested terminal `pwd`, runtime `custom/kr/gpt-5.6-luna`. Separate probe conversation, no financial writes.

SiPeKA deployment is paused. Website bridge changes were committed/pushed as `a1f6312`; production remains unchanged. At eventual deployment, supply the two server environment variables privately and verify Owner chat, Staff denial, cancellation and actual runtime.

## Owner operational mandate and active monitoring

Canonical identity mirrors: `docs/widya/SOUL.md` and `docs/widya/AGENTS.md`, deployed to `/home/ubuntu/.hermes/profiles/widya/SOUL.md` and `/home/ubuntu/FamilyAgent/Widya/workspace/AGENTS.md`. Preserve `hooks/application_context.py`, custom `kr/gpt-5.6-luna`, local 9Router and existing private tokens.

Every deletion requires a second explicit warning after the initial request, then a new explicit Owner confirmation. Name exact target, permanence, dependencies, risks and alternatives. DB deletion additionally requires a DB-specific Owner request. Archive also requires explicit confirmation; financial/audit retention remains binding. Requested reports, reconciliation, financial audit, evidenced balances, PDF/CSV exports and user/branch create/rename/archive use authorized business tools; no claim of connected write APIs or unrestricted authority. The website bridge remains read-only advisory, not a write API.

Supported persistent Hermes cron, named profile `widya`:

- Job `ebe2ca88af83`, `0 0,6,12,18 * * *`, timezone `Asia/Jakarta`: 00:00, 06:00, 12:00, 18:00 WIB; unlimited recurrence.
- Private delivery and failure notice: `telegram:1122048904`. Active shared `hermes-gateway.service` executes the profile scheduler.
- Deterministic `--no-agent` script `/home/ubuntu/.hermes/profiles/widya/scripts/widya_monitor.py`; versioned source `docs/widya/widya_monitor.py`. No inference dependency or provider changes. Project workdir is the Widya workspace.
- Read-only website `/`, `/api/health`, `/api/ready`, DB query inside `BEGIN READ ONLY` with statement timeout, disk/gateway state, daily PostgreSQL/receipt and VPS backup result/timestamp, sanitized R2/Supabase acceptance evidence. No payroll PII, financial writes, service restarts or SiPeKA deploy.
- At 00:00, add the latest-24-hour summary from locally retained monitoring samples. First day is explicitly partial coverage; point-in-time sampling is not continuous monitoring or a full financial statement. No balance/accrual claims from record counts.
- Runtime evidence: `/home/ubuntu/.hermes/profiles/widya/monitoring/{samples.jsonl,latest.txt,telegram-proof.json}`; local installation/probe artifacts `D:/FamilyAgent/Flora/generated/widya-vps/monitoring/`.

Actual 2026-10-07 02:02 WIB verification: website/health/readiness/DB OK; gateway active; disk 17.3%; ledger count 0, branch count 6 (not a cash balance). PostgreSQL/receipt backup completed 02:00:09 WIB with R2/Supabase API acceptance; VPS backup completed 2026-10-06 03:24:12 WIB, offsite verification unavailable from its last-24-hour journal. Manual job run succeeded, Telegram API returned message ID `9`; device delivery/read status remains unverified. Job list readback confirmed active recurrence and next run `2026-10-07T06:00:00+07:00`.

An initial probe used urllib's default User-Agent and falsely reported HTTP failures behind the website filter. Corrected explicit User-Agent; rerun returned all website checks OK and sent the corrected report. Existing historical samples retain that probe failure for audit.

Commands: `/home/ubuntu/.local/bin/hermes --profile widya cron list`, `cron runs ebe2ca88af83`, `cron run ebe2ca88af83` (sends a real private report). Configure timezone with supported `hermes --profile widya config set timezone Asia/Jakarta`; do not hand-edit cron/config storage.

References: https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server and https://hermes-agent.nousresearch.com/docs/developer-guide/programmatic-integration . VPS inspected source revision `765342435`.
