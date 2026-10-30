# SVMA V8.1 — Tally name and order reconciliation

This is the complete supplied V7 application with the agreed Transaction Reconciliation changes. The output categories are **Purchase, Sales, Others and Job Work**.

## Test with your existing V7 setup

1. Extract this ZIP into a new folder and open that folder in Terminal.
2. Copy your working V7 `.env.local` into this folder. Keep the same Supabase URL and keys. If starting from scratch, use `.env.example` and the existing installation instructions in README.md.
3. Install dependencies:

   ```sh
   npm ci
   ```

4. Start a separate test instance:

   ```sh
   npm run dev -- --port 3001
   ```

5. Open http://localhost:3001, sign in with your existing account and open **Finance → Transaction Reconciliation**. The account must have Finance Transaction access.
6. Upload the other day's **Weighment Register, Gate In, Gate Out and Tally Daybook**. Gate In/Out accept multiple files, including adjacent dates. Only one operational Weighment day is accepted per run.
7. Click **Run Reconciliation**. If the date cannot be detected from the Weighment report, choose the date override and run again.
8. Open **Name Verification** to see Supplier/Customer alongside Tally Particulars, Vch Type and Vch No. Open **Gate Mapping** for unresolved repeated trips.
9. Download **SVMA CR** for Main plus the four category sheets, summary, name evidence, Gate mapping, Tally check and unmatched entries.

**No new SQL migration is required for an already configured V7 database.** This release uses the existing run-history tables. Do not rerun initial schema SQL on an existing database. The application reports a warning if results are calculated but history cannot be saved.

## What “Matching with Tally” means

- Vehicle matching runs first to identify Gate candidates. Material, party and date distinguish trips.
- Gate In Purchase Order No and Gate Out Supplier Order No (the SO field) are checked against full Tally voucher/order references.
- Gate Supplier/Customer and the Weighment Party Name are independently checked against Tally Particulars, including supporting registers and voucher ledger lines.
- **A matching name counts as Matching with Tally even when the PO/SO is missing or different.** The original names, match basis, dates, companies and all relevant voucher numbers remain visible.
- All actual voucher dates in the uploaded Daybook workbook are searched for name presence. A name-only finding does not certify that this particular delivery was booked, paid or quantity-reconciled.
- “Not found in uploaded Tally” describes the files supplied to this run, not the entire live Tally system.
- Repeated voucher appearances are consolidated. Name-level vouchers may appear against several physical movements. Repeated Gate trips remain candidates and are not assigned by row order.

## The four categories

| Category | Treatment |
|---|---|
| Purchase | Raw-material inward purchases, including Rice Bran and Copra, or other material with an inbound PO |
| Sales | Commercial outward orders; SOYABARI / JWBARI remains Sales |
| Others | Firewood, water, store material, gunny, inner shifts and unresolved miscellaneous movements |
| Job Work | An explicit job-work material description or configured reference prefix, initially JOW-SO/ or JOW-PO/ |

Name checks run for every category, including Others. Future raw-material families, exact party aliases, name thresholds and job-work prefixes are maintained in `DEFAULT_RULES` in `lib/transactionPresence.ts`. No vehicle, supplier, order, voucher, date or expected sample total is hardcoded in the production matching engine.

## Included reference test

`reference-samples/validation-10-Sep-2026` contains the supplied reference reports and the row-level expected Tally presence result. These files are test fixtures only; the upload route does not read them.

| Category | Entries | Matching with Tally | Not found |
|---|---:|---:|---:|
| Purchase | 25 | 23 | 2 |
| Sales | 22 | 16 | 6 |
| Others | 28 | 7 | 21 |
| Job Work | 0 | 0 | 0 |
| Total | 75 | 46 | 29 |

Run the automated tests and production checks:

```sh
npm run test:reconciliation
npm run test:reconciliation-api
npm run typecheck
npm run build
```

The API tests mock authorization and database history; they do not connect to your live Supabase project or insert records. Uploading through the signed-in application uses your existing history tables.

## Scope

Quality, Solvent, ticketing, purchase-payment reconciliation, authentication and SQL migrations retain the supplied V7 implementation. Finance Transaction now uses one shared presence engine for the screen and export. Older release notes and finance specifications are historical; this guide defines the current transaction behavior.

See `VALIDATION_V8_1.md` for the completed checks and test limits.
