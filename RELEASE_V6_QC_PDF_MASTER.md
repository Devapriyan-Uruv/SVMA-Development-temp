# SVMA V6 — QC PDF Master Correction

## What changed
- Rebuilt Quality master from the three approved PDFs only.
- 19 Rice Bran rows, 32 Palm Kernel rows, 32 Copra rows; 83 total.
- Removed the UI split between scheduled/hourly vs once-per-shift Quality rows.
- Each selected family now shows every product/test group and parameter in one continuous sheet.
- Every row shows its exact source target immediately beside the parameter.
- All 8 shift hours remain visible and enterable for every parameter, irrespective of source frequency.
- Each hour accepts a result or NA; NA requires a reason; blank is Missing.
- Quality shift completion expects 8 readings/NA records per active parameter.
- Deviations use the exact Family + Product/Test Group + Parameter target only.
- Approved bare numeric target specifications (e.g. 15, 6, 1.5) are treated as exact targets.
- Existing RLS/auth/historical entries are preserved. Old incorrect Quality-master rows are deactivated, not deleted.

## Database
Existing V5 database: run `sql/014_v6_exact_qc_pdf_master.sql`.
Fresh/older database: apply the prior migrations through V5 first, then V6.

## Important source preservation
Rows such as `FLASH POINT > 120*` / `FLASH POINT < 120*` whose Target Specification cell is `NIL` are stored exactly that way and are not reinterpreted.
