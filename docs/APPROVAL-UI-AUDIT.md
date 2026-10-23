# Approval Center UI audit — 24 October 2026

## Findings and changes

- The empty queue repeated its count in the page heading, an oversized warning banner, and another full-width state card. The page now has one centered empty state with a transaction-history action and a refresh control.
- Every ordinary pending transaction inherited a warning flag and therefore appeared as a priority. This unsupported priority label and the non-actionable “Protected Ledger” badge were removed. Pending records now say “Menunggu”.
- Long transaction descriptions were truncated; date strings were escaped twice. Cards now wrap descriptions, display IDs/dates once, and show the amount clearly. All dynamic fields remain escaped.
- Cards lacked a direct path to review transaction evidence. “Lihat rincian & bukti” opens the existing transaction drawer by its original transaction ID; it does not approve or alter data.
- Confirmation previously showed only a queue label and an English action name. It now includes transaction description, amount, branch, date and queue reference. Cancel receives initial focus; Tab stays within confirmation controls. The existing dialog remains dismissible before submission.
- Confirmation could be pressed repeatedly while a request was in flight. The button now shows progress and ignores concurrent activation. Failed/uncertain responses keep the dialog open and disable immediate retry, with a prompt to reload status. A successful decision uses the same endpoint, action values, notes, authorization and subsequent refresh as before.
- Layout uses the accepted theme tokens, one-column cards on narrow screens, wrapped metadata and controls at least 44 pixels high.

## Validation

`tests/approval-center-ui.test.js` renders production functions and styles with synthetic data and mocked authorization calls. It covers light/dark empty states, centered text, pending cards, branch filtering, XSS-safe descriptions, detail-to-transaction binding, initial confirmation focus and keyboard cycling, cancel-without-write, exact approval request payload, duplicate-click prevention, source failure, refresh, staff action hiding and mobile overflow. No real financial decision or notification was performed.

24 related UI, report/export, workbook/date and source-failure checks passed. The older `tests/frontend-real-data.js` suite has five pre-existing failures (missing operational helper extraction and outdated audit expectations); the same failures were reproduced against the unchanged HEAD baseline. They were not altered as part of this Approval Center UI revision.

No backend authorization, approval thresholds, ledger rules, schema, account mappings or deployment changes are included. This revision is pushed to GitHub for review before a separately authorized deployment.
