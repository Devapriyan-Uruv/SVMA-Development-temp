# V5 validation and UAT status

## Automated static controls - PASS

`npm run validate:v5` passes 15/15 controls:

- target required before data-entry submission
- target missing never creates a deviation
- shift finalisation blocks target gaps
- target-less rows are inactive for operational entry (with defensive UI lock for legacy rows)
- target-less source rows are removed from live operational entry
- Admin requires target for active data-entry parameters
- ambiguous bare numeric targets do not auto-deviate
- three source-confirmed Quality NIL targets are migrated
- target-gap audit view exists
- V5 one-shot SQL is Supabase SQL Editor compatible
- transaction reconciliation preserves Weighment row population
- payment reconciliation uses Payment/Agst Ref allocations
- ambiguous accounting candidates become Needs Review
- time-aware greeting exists
- benchmark identifiers are not hardcoded in production TS/TSX

## Source syntax validation - PASS

All 98 `.ts` / `.tsx` files under `app`, `components`, `lib` plus `proxy.ts` were transpile/syntax checked with TypeScript 5.8.3 and no syntax diagnostics were produced.

## Source-document target verification

The supplied Solvent source PDF was visually verified at the affected pages. Its target column is genuinely blank for five source rows (three Cooling Tower fan AMS checks, Mixing Grade Quantity, Fire Hydrant Pressure monitoring). V5 therefore does not invent targets. Those rows are configuration blockers until SVMA supplies approved values.

## Dependency-backed build - environment blocked

`npm run typecheck` currently stops before application semantic checking because the packaging environment has an incomplete `node_modules` and cannot resolve the npm registry. Missing type libraries reported:

- node
- node-fetch
- react
- react-dom

Required release command in a normal network-enabled environment:

```bash
npm ci
npm run validate:v5
npm run verify
```

`npm run verify` must pass before deployment.

## Live UAT still required against the destination Supabase project

1. Apply V5 migration and inspect `data_entry_target_gaps`.
2. Confirm the five source-blank Solvent rows are inactive and visible in Administration; configure SVMA-approved targets before activating them.
3. Test all three Quality products across all three shifts.
4. Confirm all eight Quality hour columns stay visible irrespective of frequency.
5. Verify target-less rows cannot accept result/NA and cannot close a shift.
6. Verify in-spec, out-of-spec, NA and missing handling.
7. Verify Quality report generation/preview/PDF/print and notifications.
8. Run Transaction Reconciliation against supplied operational files; check Main row conservation and exceptions.
9. Verify the documented accounting regression chain when the source dataset containing it is supplied.
10. Run Purchase Payment Reconciliation; test multi-lot voucher allocation, vendor aliasing, direct purchase review, under/over payments and source-missing cases.
11. Export SVMA CR Excel, payment Excel, management PDFs and inspect formatting.
12. Test CEO, Finance, Quality, Solvent, Admin and mobile permissions with real RLS users.
