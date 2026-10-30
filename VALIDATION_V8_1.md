# Validation for V8.1

The reference-day result reproduces all 75 approved row-level classifications, Tally statuses and voucher-reference sets: 25 Purchase, 22 Sales, 28 Others and 0 Job Work; 46 name/order presence findings and 29 not found in the uploaded Tally records.

## Checks completed

- 44 reconciliation checks: legacy XLS and XLSX parsing, original row/vehicle/weight agreement, all 11 Tally sheets, name-only and order-only evidence, normalization, source conservation, repeated trips, adjacent and distant dates, absent identifiers, unknown headers, duplicate vouchers, explicit job-work rules, future identifiers and Excel round-trip output.
- 7 API checks: four-file upload, downloadable category/evidence workbook, authentication and Finance-access enforcement, malformed uploads, old export payload rejection and history-save failure handling. Authorization/database responses are mocked in these tests; no live data is written.
- TypeScript typecheck passed.
- Next.js 16.3.1 optimized production build passed, including all 61 static-page generation steps.
- Supplied V7 Solvent validation: 19/19 controls passed.
- Supplied V6 validation: 13/14 text checks passed. The remaining check searches for the literal `ambiguous: false`, but the unchanged V7 parser contains `ambiguous:false`. Direct execution of `parseTargetBounds('65')` confirms `exact: 65` and `ambiguous: false`. This is a pre-existing whitespace-sensitive checker; neither that checker nor the operational parser was changed.

## Limits

- An authenticated browser run against the user's live Supabase project was not performed. The local environment prevented the production server from binding its preview port; production compilation and direct upload/export handler tests passed.
- Name presence intentionally includes earlier voucher dates and different voucher families in the supplied file. The result does not claim delivery-level booking, payment or quantity verification.
- Similar-name findings may include branches or spelling variants. Original source names and companies remain visible for review; no invisible party merges are stored.
- Empty or ambiguous Gate assignments remain visible. Missing weighment reference/vehicle cells do not discard otherwise identifiable physical rows.

No production rules load the reference fixture files or embed their transaction identifiers or expected counts.
