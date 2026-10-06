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

SiPeKA deployment is paused. Local changes are uncommitted/unpushed. VPS changes only enable private Hermes API plus verification script; SiPeKA production app remains untouched. At eventual deployment, supply the two server environment variables privately and verify Owner chat, Staff denial, cancellation and actual runtime.

References: https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server and https://hermes-agent.nousresearch.com/docs/developer-guide/programmatic-integration . VPS inspected source revision `765342435`.
