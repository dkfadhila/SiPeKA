# Reports and Export UI audit — 24 October 2026

## Findings and corrections

- Each card previously exposed preview, CSV, Excel, PDF and metadata as competing buttons. Cards now expose Preview and one native disclosure for download choices. Only one download menu stays open; Escape closes it and returns focus to its summary.
- The page footer rendered integration instructions, endpoints, dataset names, schemas and proposed API contracts. That block was removed from product markup. Technical provenance and contracts remain in the report catalog and downloadable file information for integration/debugging.
- Cards displayed implementation terms such as Backend Owner, Snapshot and raw source readiness. Cards now show short availability labels and the number of records under the active filter. Unavailable tax/budget data keeps actions disabled.
- Previews previously printed raw provenance and internal notices. They now show selected dates and branch, readable column labels and relevant coverage notes. Internal IDs unrelated to the displayed transaction are omitted from preview columns. CSV, PDF, Excel and file metadata retain their original data contracts.
- Editing filters previously left the prior preview and totals visible. Draft filters now replace the old preview with a clear pending message and hide the old totals. Applying filters or choosing Preview/Download continues to use the visible date and branch fields. Source responses cannot overwrite a preview selected after the request began.
- Cards use aligned actions and responsive columns. Dropdowns stay within mobile page bounds; wide report tables scroll within their container.

## Technical contract retained outside the UI

The report module accepts `setSnapshot({rows, units, user, advanceRows})`. Owner operational sources use authenticated `GET /api/reports/{id}` and `/export` with branch, inclusive WIB date range and explicit output format. Snapshot-based report inputs must contain all relevant pages. Source completeness, provenance, missing datasets and original row values remain available through the report API and exported metadata; removing developer prose does not certify reconciliation or financial-statement completeness.

Unavailable balances and accruals remain unavailable. Approval does not prove disbursement; receipt references do not prove file/content verification. No account list is added to reports. No schema, financial record or dependency changes are required.

## Verification

`tests/report-catalog-ui.test.js` loads the production report/metrics scripts and CSS in a local synthetic HTTP fixture. It checks user-facing copy, unavailable actions, dropdown interaction and keyboard dismissal, stale-preview removal, changed date/branch filters, invalid ranges, actual XLSX download through the production exporter, desktop/mobile layouts, and source-failure handling. The fixture uses synthetic records only and contacts no production service. Existing date, amount, workbook and embedded-module regressions remain covered.

The PostgreSQL/browser release fixture was updated to open the download disclosure before selecting a format. This revision is GitHub-only pending Owner authorization to deploy.
