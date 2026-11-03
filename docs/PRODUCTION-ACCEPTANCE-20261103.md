# Production acceptance — 3 November 2026 WIB

Target: widyafa.xyz, original frontend. User authorized synthetic transactions, branch/employee/company tests, one payroll test email, Git push, and new test accounts after forgetting existing credentials. No original passwords reset. No preview design deployed.

## Defect fixed

Manual transaction Save stopped before the API call with `selectedCoaType is not defined`: the handler referenced a function in another script closure. Scan had the same reference. Shared `SipekaCoaInput.selectedType` now resolves the selected catalog type for both handlers, preserving missing/invalid selection rejection and REVENUE/EXPENSE mapping. Regression test evaluates embedded and standalone script closures.

Fix `811fcc44eabc1275cc87ac8bf677b6f7e8917f9b` was pushed and deployed as an immutable production release, readiness verified. Previous release: `3e253cb69117264c43aa6deb2687126767ef2111`. Dependency lockfile and applied migration bytes preserved; no schema changes, staging/preview untouched. Earlier test-only commit c5a110e fixes the branch seed fixture password to meet the existing uppercase policy.

## Live results

- Created labeled Owner test account on VPS, authenticated normally. Created laundry device through Owner UI, then logged in with its actual username/password. No fabricated session or bearer bypass.
- Created branch **UJI Laundry 03 Nov**, code **TST**; synthetic payroll employee and separate on-duty employee in Laundry Cabang. Names, departments and assignment persisted.
- Laundry submitted income `TX-EEAD707A19`, expense `TX-3FBC93BB4B`, and funding request `ADV-AF1153E08C`, each Rp1,000 with uploaded labeled test evidence. Owner saw all IDs, amounts, branch/device and on-duty identity. Funding request started pending and was approved via confirmation; **no disbursement or real money transfer** performed.
- Filled daily closing for the test device; its shift became read-only and Owner saw the closing. Physical-cash entries are synthetic, not reconciliation of real cash.
- Downloaded income/expense CSV/XLSX/PDF. Transaction CSV dated 3 November includes all test IDs; 2 November excludes them. Balance sheet, cash flow, branch P&L and comparison P&L XLSX/PDF downloaded with the chosen scope.
- Temporarily changed company name to **CV UJI SISTEM AMC 03 NOV**, verified the profile and PDF header, then restored exact prior value **Perusahaan Demo SiPeKA**.
- Actual laundry CSV template used for the synthetic employee. Live Widya returned LANJUT; gross Rp16,000 minus Rp300 deductions equals Rp15,700 net. Separate review, draft, publication and send confirmations completed.
- Draft and published slip PDFs downloaded. Published slip is one readable page, correct net and identity, without draft issuance marker. One email was sent to the exact destination in the current user request. Status **sent means provider accepted**, not inbox delivery. No retry; subsequent send button disabled.
- Anonymous slip download denied (401), Staff payroll access denied (403). New test account sessions expired at completion; next login requires a password change. Original credentials unchanged. Financial/test records retained, no deletion.

## Evidence and limits

Final counts: 103 transactions, 9 operational employees, 2 payroll entries, 7 units, 40 registered documents. Initial: 100, 7, 1, 6 and 26. Differences are authorized synthetic operations and document issuance. Production active and readiness 200.

Five XLSX files passed ZIP/XML/relationships and openpyxl opening. Seven initial PDFs had readable text. Slip rendered and visually inspected; published PDF separately passed identity/net/draft-marker checks. Not a fresh desktop Microsoft Excel certification. Local focused suite: **28 passed, 0 failed, 1 skipped** (isolated PGlite runtime not configured). Scan handler is regression-tested; live scan/vision was not exercised.

Workspace evidence: `outputs/20261103-production-e2e` contains setup, transactions, closing, Owner/report proof, review, email result, file validation and deployment/test logs. Private credentials/browser sessions, generated payroll and test artifacts are not committed. A pre-existing background-file request `pdf_bg_base64.txt` returned 404; tested PDF generation succeeded. Complete infrastructure security, every error path and inbox arrival are outside this acceptance.

Backup service recorded success at 02:00 WIB before this run. Previous release path saved at `/var/backups/sipeka/production-e2e-20261103/previous-release.txt`. Rollback code by atomically restoring that current symlink and restarting only sipeka.service, then verify readiness. Code rollback does not undo retained test data or unsend email. No records were deleted or archived.
