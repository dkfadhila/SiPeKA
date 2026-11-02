# Microsoft Excel payroll XLSX compatibility fix

The original app-produced general and laundry workbooks could be opened in LibreOffice but failed Microsoft Excel Workbooks.Open in normal mode. The source payroll templates opened normally in Excel. Exporter inspection found two pageMargins elements in Database: the original artifact-generated margins plus another element appended by payroll-workbook.js. OOXML worksheets permit one such element. Removing only the duplicate restored normal Excel opening; removing the drawing, formulas or validation alone did not.

The exporter now removes existing Database pageMargins/pageSetup before adding its intended settings, matching the already-used Slip Gaji normalization pattern. No payroll amounts, formulas, identifiers, permissions or production data changed. A regression test requires exactly one margins/setup element on each worksheet.

Verification on 2 November 2026: Microsoft Excel COM opened 12 files normally (both general/laundry × normal, duplicate key, missing component, zero, switched employee, plus both empty templates). In-memory salary changes recalculated net and Indonesian terbilang; invalid ID failed closed. Files were opened read-only and closed without saving. The pre-fix exports failed in the same normal-open test, while all three financial-statement XLSX exports opened. Evidence is in outputs/20261102-excel-compat/microsoft-excel-proof.json outside the repository.

This identifies a reproducible exporter defect; the exact warning shown on Radit's laptop was not provided. Deployment is separate. Existing downloaded files do not repair themselves; download a new file once production is updated, or use the corrected local template supplied in chat.

## Extended check after reported unreadable-content warning

The reported warning text is "Excel found unreadable content". On 2 November, all six financial-report IDs were exported with synthetic data and with empty data in company, branch and comparison scopes (36 actual OOXML workbooks). Microsoft Excel opened every workbook in normal mode and recalculated them with no formula-error cells. Numbered document metadata and eight-branch continuation sheets were included. Combined with the 12 payroll cases, 48 files have direct Microsoft Excel coverage. The financial-report warning on Radit's original downloads has not been reproduced; those exact downloaded files were not supplied. Do not infer that the warning was Protected View, or that every historical XLSX will be repaired by this change. Downloaded old files must be replaced after deployment.

The confirmed code fix is limited to duplicate Database print settings in the payroll exporter. The remaining report-card consolidation changes are separate local work. Neither is claimed deployed by this audit.
