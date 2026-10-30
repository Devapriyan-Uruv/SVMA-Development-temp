# SVMA V6 QC Correction — Test Results

## Passed
- 14/14 V6 QC static controls passed (`node scripts/validate-v6.mjs`).
- Changed TS/TSX files pass TypeScript `transpileModule` syntax validation.
- QC master integrity: 83 active rows expected by migration.
- Rice Bran: 19 rows.
- Palm Kernel: 32 rows.
- Copra: 32 rows.
- Unified Quality sheet loads all supported source frequencies together.
- Every Quality parameter uses the selected shift hour as its entry slot, so all 8 cells can be populated even when source frequency says Every 2 Hours / Every 4 Hours / Once in a Shift.
- Quality shift finalization expects 8 results or NA records per active parameter.
- Product/Test Group column is shown in the QC matrix.
- Target remains visible next to every parameter.
- Bare numeric source targets are evaluated as exact targets.
- Existing target-required API gate and mandatory NA reason are retained.

## Full build limitation in this execution environment
The package intentionally contains no `node_modules`. A complete `npm run typecheck` / `npm run build` could not be certified here because project dependencies are not installed in the execution container. Global TypeScript reports missing React/Next/Supabase module declarations for the whole project for that reason. This is an environment/dependency issue rather than a V6 source syntax failure.

Before production deployment run locally:

```bash
npm ci
npm run typecheck
npm run build
node scripts/validate-v5.mjs
node scripts/validate-v6.mjs
```
