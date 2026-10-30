# V8.4 — All modules, safety additions only

This is the complete V8.2 application plus 98 additional safety checklist definitions.
Application code, existing targets, Quality, Finance, entry validation, alerts, reports and original migrations are unchanged.

## Install and test

1. Extract this ZIP. Use this single folder for all modules.
2. Copy your working .env.local into it.
3. Finish/sync the current shift, then use a test database or apply between shifts.
4. In Supabase SQL Editor, run sql/016_v8_4_safety_ADDITIONS_ONLY.sql after the existing migrations through 015.
5. Run npm ci, then npm run dev -- --port 3001.
6. Start a new shift. Find the new points under Solvent hourly/inspection entry and Boiler entry.
7. Additional points in existing sections appear in the “AGRO additions” group. New sections appear as additional category tabs.

Changing ZIP files alone does not load database-driven parameters. Step 4 is required.

Do not run the V8.3 replacement migration. If it was already applied, restore the previous active master first using reference/safety-additions/V83_ROLLBACK_ONLY_IF_PREVIOUSLY_INSTALLED.sql. That optional rollback is only for a database which actually received V8.3. The V8.4 migration stops with an explanation if an active V8.3 replacement master is detected.

For a brand-new database, follow the existing README and SQL execution order through 015, then install the additions-only migration.

## What is added

- Softener: 15 points
- RO: 24 points
- ETP: 10 points
- Workshop: 12 points
- Refinery safety: 20 points
- Cooling Pond: 4 points
- Extractor: 1 log-sheet recordkeeping point
- Packing Godown: 3 points
- Thermic Fluid Boiler: 9 points
- Total: 98 points

The 26-point Lab Analysing Report is excluded. The existing Quality module remains unchanged. The Extractor log-sheet check is operational recordkeeping, not Lab analysis data entry.

See reference/safety-additions/ADDED_POINTS.md for each added parameter, source row and target.

## What is deliberately unchanged

- No original parameter is retired, renamed or given a different target.
- The five previously blank targets are not filled with guessed values.
- Existing equipment IDs and vacuum/temperature limits remain intact.
- Original boiler and Solvent checks remain available, including checks absent from the new workbook.
- Existing Finance and payment-reconciliation logic stays at V8.2.
- No V8.3 target-blocking or validation changes are included.
- Historical entries remain attached to their original parameters.

The source's new Cooling Pond TH/pH/TDS checks are separate from the existing Extractor checks. Source review notes identify possible overlap; no target is substituted. New points use the existing validation and alert behavior.

## Repeat safety

The migration uses INSERT only for checklist content. Existing sections use ON CONFLICT DO NOTHING. It skips existing source IDs and normalized same-section parameter names, including inactive matches, to avoid reviving or duplicating Admin-retired checks. Consequently fewer than 98 new rows may be inserted if your database already contains some additions.

Existing parameter rows, targets, flags, history and application files are not updated. Admin-created parameters are preserved.

## Validation

Every original file copied from V8.2 was compared byte for byte. All application and original SQL files are identical. The baseline's 70 automated payment/transaction checks and production build had already passed; this release changes no runtime code or dependencies.

Additional checks verified all 98 identities, nonblank targets, no Lab rows, no duplicate source identities or normalized same-section names, and the insert-only migration structure. The migration has not been applied to your live Supabase database.

The ZIP excludes dependencies, build caches and credentials, and contains no nested ZIP.
