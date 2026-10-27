# Widya private dashboard read integration

The Hermes workload reads the same PostgreSQL application source through
`/usr/local/bin/widya-dashboard-read`, with no Owner browser cookie or copied
database password. The Telegram gateway allowlist and authenticated dashboard
authorize the caller; this local helper does not accept a client-supplied actor.
It is a fixed read capability for the private Widya process, not a public API.

## Provisioning and verification

After the tested commit is pushed and checked out as `/opt/sipeka/current`, run
as root:

```sh
python3 /opt/sipeka/current/scripts/setup-widya-dashboard-reader.py --apply
python3 /opt/sipeka/current/scripts/setup-widya-dashboard-reader.py --check
```

Prerequisites: existing PostgreSQL `sipeka`, peer authentication on the local
Unix socket, `/usr/bin/node`, `sudo`, `visudo`, `setfacl` (Ubuntu `acl` package),
and root-owned release files and module-parent directories without group/other
write access. The script creates a no-shell/no-home OS identity, a matching
`widya_reader` LOGIN NOINHERIT role without a password, fixed sanitized-env
launcher, and a narrowly scoped sudoers entry for the existing `ubuntu` Hermes
service identity. It does not modify gateway allowlists, existing agent identity,
business rows, role membership, database authentication rules or other services.

The role has USAGE on public and SELECT only on these column lists:

| Table | Permitted columns |
| --- | --- |
| business_units | id, name, code, category, is_active |
| chart_of_accounts | id, account_code, account_name, account_type |
| ledger_transactions | id, branch_id, coa_id, tx_type, amount, payment_method, status, tx_intent, created_at, memo |
| advance_events | id, advance_id, action, amount, created_at, settlement_id |
| advance_settlement_lines | settlement_id, line_no, coa_id, amount |
| cash_closings | id, branch_id, closing_date, system_balance, physical_cash, difference, reason |
| company_profile | name, revision, updated_at |
| operational_staff | id, branch_id, name, department, active, revision |
| app_users | id, assigned_branch_id, full_name, role (device query returns STAFF only) |
| document_registry | id, code, report_id, report_code, branch_id, unit_code, date_from, date_to, view_mode, created_at |

No grant covers sessions, user credentials/contacts, payroll, receipt keys, binary receipts, or
advance request/result payloads. Provisioning rejects effective unexpected
table/column/sequence privileges, SECURITY DEFINER execution in application
schemas, schema/database creation, role membership, ownership, password or
administrative role flags. It refuses a broadly privileged existing role rather
than approving or silently repairing it. Both initial grant and audit happen
in one database transaction. PostgreSQL system catalog visibility and default
PUBLIC privileges are outside a general OS/tool sandbox; the audit checks
application object access specifically.

The launcher clears `NODE_OPTIONS`, `NODE_PATH`, connection variables and other
caller environment by using `env -i`. The CLI validates a single bounded JSON
argument, checks the database role, and uses a repeatable-read READ ONLY
transaction with statement/idle timeouts and fixed parameterized queries.
Sources over 10,000 rows fail; record lists are explicitly truncated to 100.
Dates use inclusive WIB days and exclusive UTC upper boundaries. Money is
integer strings/BigInt; shared `informational-statements.build` prevents counting
advance approval/disbursement as realized expense and leaves unavailable totals
unavailable.

The OS account receives execute-only ACLs on the required release ancestors,
read access to the helper source files and package metadata, and read/traverse access to the
resolved npm module tree inside `/opt/sipeka`. No ACL recursion through the app
release, uploads, generated artifacts or `/etc/sipeka` is performed. Repeat
`--apply` after each new release, because its directory is new. `--check` is
read-only and verifies the role, installed files and peer authentication.
An existing Hermes/ubuntu account with broad terminal/sudo capabilities already
has wider powers: this helper does not claim to sandbox that account or all
Hermes tools.

Install the versioned `docs/widya/dashboard-reader/SKILL.md` into Hermes's
discoverable skill directory as `sipeka-dashboard-reader/SKILL.md`; preserve
existing SOUL, AGENTS, hooks and skills. Read the actual skill inventory and
verify loading before reporting activation. A code checkout alone does not
install a Hermes skill.

Verify the actual launcher from the service account with a branch-master read.
For financial smoke tests, summarize only success, scope, counts and timestamps
in general deployment logs; keep private amounts/memos in the authorized
conversation. Verify the private bot's response with no unsolicited message to
other users. A Telegram send acceptance is not proof of device delivery/read.

## Website coverage

`capabilities` exposes an explicit capability matrix. The helper reads branch
master, current company, employee/device noncontact metadata, dated transactions,
pending approvals, physical closing observations, recorded summaries and issued
document-number metadata. Company/directory data is a current snapshot;
document dates filter issuance time rather than each document's financial period.

It does not read accounting journals/trial balance, complete accrual statements,
encrypted payroll amounts, calendar notes or Owner-scoped chat history. It does
not mutate data, issue document numbers, generate a report export or send a
Telegram message. An API-server toolset audit found no messaging/send-message
tool even though the Telegram platform is connected; outgoing delivery from
website conversations requires a separately registered authorized tool. Hermes's
broader terminal permissions are not proof such a product integration exists.

## Tests

```sh
node --test tests/widya-dashboard-reader.test.js
```

Set `REPORTS_TEST_PGLITE` to an installed `@electric-sql/pglite` directory for
portable PostgreSQL/WASM integration coverage. The fixture creates an isolated
database, runs real reader SQL and production privilege-audit SQL, tests exact
money and WIB boundary dates, disbursement/settlement/return accounting, private
column denials and refusal of unsafe role/function grants. It never connects to
production, sends Telegram messages or accesses real payroll/receipts.
