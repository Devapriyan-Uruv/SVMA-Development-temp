# SVMA V8.2 — Daybook-first payment amounts and transaction comments

This complete application includes the V8.1 transaction reconciliation and the new payment amount review. Solvent, Quality and transaction matching code are preserved.

## Run a separate test instance

1. Extract the ZIP into a new folder.
2. Copy your existing working .env.local into that folder. Never share that file.
3. Run npm ci, then npm run dev -- --port 3001.
4. Sign in at http://localhost:3001 using your existing account.
5. Open Finance → Purchase Payment Reconciliation. Your account needs Finance Vendor Payment access.
6. Upload the selected day's Tally Daybook and a Credit / Debit Note List covering the relevant purchase lots.
7. Run reconciliation. All Payment vouchers are the starting population; every reference allocation remains separate.
8. Read each transaction comment, open Trace for source rows/name candidates, and download Reconciliation Excel.

No new SQL migration is required for an existing configured V7/V8.1 database.

## AI comments

The existing server-side OPENAI_API_KEY and OPENAI_MODEL settings are used. The default model remains the existing gpt-5-mini. When configured, reconciliation sends a compact transaction evidence summary to OpenAI to generate a comment for every row. Raw workbooks are not sent. Requests set store:false.

AI comments are labelled AI-generated. They cannot modify amounts, statuses, references or formula outputs. Rule Evidence remains alongside AI commentary in the export and Trace. Missing credentials, timeouts, malformed answers or omitted row IDs leave clearly labelled Rule-based fallback comments. The page reports how many AI comments were generated.

AI generation is a review aid; its wording should be assessed against the fixed source evidence. This package's API integration was tested with simulated responses, not a live paid API call.

## Amount logic

- Read only Vch Type = Payment from Day Book; include Agst Ref, New Ref, Advance and On Account.
- Compare each reference's own E allocation, not a duplicated parent I total.
- Split six-digit lot tokens from C; confirm lot against Credit LotNumber and independently verify vendor names. Minor name variations and configured aliases are supported.
- Name-only findings show candidate vendor/lot rows but do not assign an unrelated lot's amount.
- Compare Actual to Credit AI NetValue independently of the calculated amount.
- Indirect / Normal Purchase: AJ + configured GST on AJ - full rebate - AB - AC - AH.
- Full rebate: AP when nonzero, otherwise AK + AL + AM + AN.
- Direct Purchase candidate: AJ + configured GST on AJ - AH. This is the observed Sri Amman pattern. Candidate agreement is explicitly review-required and does not erase AI differences.
- Default GST 5%, tolerance ₹1; existing active NORMAL_PURCHASE database settings still apply.
- Source Advance is surfaced without inventing an offset.
- Unknown purchase types, invalid BillValue, ambiguous candidates, repeated lot references and broken voucher controls stay reviewable.
- No-reference vouchers retain their recorded total and are distinguished from explicit advances.
- Source dates, original voucher strings, credit rows and Daybook rows are retained. No sample date/vendor/amount is hardcoded.

The operational Purchase / Sales / Others / Job Work categories in transaction reconciliation are unchanged. Firewood/water/stores remain Others there. Payment review retains those payments for completeness without treating them as bran purchase matches.

## Included sample expectations

Use reference-samples/validation-10-Sep-2026:
- 43 Payment vouchers; 47 output lines; total ₹1,47,09,562.
- 10 matched credit lots; 9 formula agreements within ₹1.
- Seven existing-rule matches and two Direct candidate matches.
- Oviya 083012: formula difference -₹40,000.25; Credit AI difference -₹40,001.
- Oviya 090907: vendor found, lot not identified; ₹45,900 kept separate.
- Three AI differences remain visible, including the two Sri Amman lots.
- 30 missing-source lines, one explicit advance, five no-reference vouchers.
- All 38 reference-bearing vouchers balance.

## Verification

npm run typecheck
npm run build
npm run test:payments
node scripts/test-payment-api.mjs
npm run test:reconciliation
npm run test:reconciliation-api

70 automated checks passed: 14 payment-engine/comment checks, 5 payment API/export checks, 44 transaction checks, 7 transaction API checks. External database/AI calls are mocked during API tests. See VALIDATION_BUILD_V8_2.txt and VALIDATION_PAYMENT_SAMPLE_V8_2.json.
