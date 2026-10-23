# Audit Device & Cabang — 24 October 2026

Device & Cabang now has four Owner-only sections: Device, Branches, Karyawan, and Perusahaan & Gaji. Device accounts no longer compete with employee and payroll forms on the same page. Employee creation and each employee edit use disclosures; company and payroll retain their existing validation, revision, publication and email controls.

Branches presents the branch register before its creation form on narrow screens. Access policy notes are collapsed. Long names wrap, forms stack, action buttons have a minimum 44px height, and the section navigation scrolls within its own container on small screens. Existing account hiding is labelled honestly as browser-local visibility; it does not disable authentication. Branch actions use escaped data attributes and bound handlers so names containing apostrophes remain intact.

Validation: 23 related tests passed, including production-function browser fixtures at widths 360, 390, 768 and 1440, light/dark themes, tab separation, exact branch action arguments, local device visibility, staff email confirmation and revision payload, Staff access denial, embedded-source synchronization, payroll readiness and reports/Excel regressions. Screenshots inspected using synthetic data. The retained PostgreSQL release fixture was adapted for the new tabs and disclosures and syntax-checked; that full fixture was not re-run for this UI-only change. No financial production writes or payroll messages are part of UI verification.

Release is authorized by the user's deploy request. Follow GitHub-first release, fresh backup, readiness checks and public-source hash verification; runtime evidence is stored outside Git.
