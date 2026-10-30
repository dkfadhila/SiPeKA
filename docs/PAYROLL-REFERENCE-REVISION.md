# Payroll template revision - 30 October 2026

General and laundry slips use the approved centered letterhead, grayscale frame, minimum 10 pt annotations and 12 pt body text. Two line spaces follow publication metadata. Signature blocks sit near the bottom. Requested boilerplate and the payment/status footer are removed. The identity status remains. The generated border is embedded with its alpha mask; no image library is needed at runtime.

The general template now includes operational/health allowances, overtime, bonus, absence/late/violation deductions, optional PPh21, job title, employment status and payment method. Laundry retains its food, transport and ironing components and adds the reference fields. Laundry other_deductions is additional to the three explicit deductions, avoiding a duplicated aggregate. Amounts are reviewed nominal integer rupiah; rates per kilogram/day are not inferred.

The template endpoint accepts type=general or type=laundry. Prior supported CSV headers remain valid. Identity and placement come from the staff directory. Components and the custom letterhead address are stored inside the existing encrypted payroll snapshot. No migration or production salary import is part of this release.

Frontend renders the same component fields and totals as the backend, displays job/status and the snapshot address, and sends company_address with the CSV. Owner confirmation and publication gates remain.

Validation: 30 selected unit, PDF, exact-integer, delivery-contract and browser tests passed locally. The browser check covers detailed rows, job/status, the address request payload, publication confirmation and blocked ambiguous delivery. PDFs were rendered and inspected. Wider legacy suites include an obsolete payrollSendControls UI check absent in the deployed baseline, older PDF wording expectations, a VPS-only fixture and PGlite-only tests requiring separate configuration. These are not represented as passing release checks.

Deploy without migrations: back up, materialize the exact GitHub commit into a new release directory, reuse the unchanged dependency tree, atomically switch current, restart only sipeka.service and check readiness/public asset parity. Preserve the prior release for rollback. Do not send production payroll messages or create business data for verification.
