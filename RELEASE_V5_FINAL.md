# SVMA Intelligent AI Operations - V5 Final Delivery

Date: 11-Sep-2026

This release modifies the existing SVMA Next.js/Supabase application. It does not replace the application with a disconnected demo.

## Final target/deviation control

The data-entry contract is now strict:

1. Every active Quality/Solvent/Boiler data-entry row must have a visible `target_text` before an operator can submit a result or NA.
2. A parameter without an approved target remains in Administration/audit but is made **INACTIVE** for operational data entry until the target is configured.
3. The UI defensively locks any legacy target-less row if one is encountered before migration.
4. The API independently rejects target-less submissions with `TARGET_REQUIRED`.
5. A shift cannot be finalised while an applicable active mandatory parameter has no target (`TARGET_CONFIGURATION_REQUIRED`). This is not bypassed by normal deviation handling.
6. Admin cannot create or activate an active data-entry parameter without a target.
7. Deviation classification is deterministic and can occur only when a visible target exists. A blank target can never become Normal/Warning/Critical.
8. Bare numeric source targets whose meaning is ambiguous remain visible for audit but are not silently interpreted as an exact/min/max rule. Admin must configure an explicit threshold/rule before automatic deviation is allowed.

Three Quality targets that are explicitly defined as `NIL` by the supplied Quality source/brief are repaired by the V5 SQL migration: PK DT Flash, Copra DT Flash, and DORB DT Flash Test.

The supplied Solvent PDF itself has five rows with blank target cells. V5 deliberately does not invent values for them. They remain visible in Administration but are inactive for operational entry until SVMA approves a target:

- Cooling Tower Fan No 1 Load AMS Check - source page 3
- Cooling Tower Fan No 2 AMS Check - source page 3
- Cooling Tower Fan No 3 AMS Check - source page 3
- Mixing Grade Quantity Properly Mixed Outgoing Conveyer Every Hour - source page 16
- Fire Hydrant Pressure Point View Factory Front Side and Middle and Last Pressure KG Monitoring - source page 19

## Product experience

- Industrial liquid-glass app shell and responsive navigation.
- Sidebar independently scrolls, supports collapsed state persistence, and becomes a mobile drawer.
- Sticky top header.
- Time-aware local greeting from the signed-in profile.
- Custom SVMA navigation SVG icon system.
- Quality matrix keeps all eight shift hours visible; frequency is reference metadata and does not hide hour columns.
- Explicit Blank vs NA workflow; NA reason mandatory, and `Other` requires a note.
- Quality zero-result health is `N/A / Awaiting Quality Results`, never 100%.
- Central Reports section and CEO operational/finance exception visibility.

## Finance transaction reconciliation

The V5 transaction engine keeps Weighment as the physical master population and produces exactly one Main output row for every supplied physical row. It uses deterministic staged matching, no vehicle-only final match, no first-match-wins, duplicate accounting protection, cross-day/date evidence, KG/MT quantity evidence, and explicit `NEEDS REVIEW` for ambiguity.

Final accounting confirmation is separated from ERP/Gate linkage. The application exposes independent ERP and Tally states while the official SVMA CR keeps the business status classification column.

Excel export includes Main, category filters, exceptions/source controls and traceability information.

## Purchase payment reconciliation

- Uses actual Day Book `Payment` vouchers and `Agst Ref` allocations.
- Supports one voucher paying multiple lots and performs voucher allocation total control.
- Keeps Payment Voucher, Bank Reference, Agst Ref and Lot as separate identifiers.
- Uses Lot + Vendor as the strong key; lot-only matching is prohibited.
- Vendor aliases are configurable.
- Normal/Indirect Purchase rule is versioned in `finance_reconciliation_rules` with configurable GST/tolerance.
- Money calculations are performed in integer paise in the application engine.
- Direct Purchase is not forced through the Normal Purchase formula; it becomes `RULE REVIEW REQUIRED` until configured.
- Unexplained differences remain unexplained; the engine does not invent Advance/Adjustment values.

## Database

V5 is additive. It does not drop authentication/RLS or historical operational/reconciliation data. New/extended controls include NA result metadata, finance rule configuration, vendor aliases, manual-review audit storage and the `data_entry_target_gaps` audit view.

See `SQL_EXECUTION_ORDER_V5.md`.

## Environment

No new environment variable is required. Use `.env.example`:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `NEXT_PUBLIC_APP_URL`

## Validation status

- 98 TS/TSX source files: syntax/transpile validation PASS.
- `npm run validate:v5`: 14/14 V5 invariant checks PASS.
- Full dependency-backed `tsc --noEmit` / `next build` could not be completed in the packaging environment because npm dependencies are not installed completely and outbound npm registry DNS is unavailable. The observed TypeScript failure is missing type packages (`node`, `node-fetch`, `react`, `react-dom`), not a reported application source error.
- Before production deployment, run `npm ci && npm run verify` in a normal network-enabled CI/developer environment and complete live Supabase UAT.

