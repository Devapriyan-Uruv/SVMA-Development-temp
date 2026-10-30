# Latest test release: V8.2

Start with [START_HERE_V8_2.md](START_HERE_V8_2.md) for Daybook-first payment reconciliation and AI transaction comments. Earlier release documentation follows below.

# Current release: V8.1 Tally reconciliation

Start with [START_HERE_V8_1.md](START_HERE_V8_1.md) for this ZIP. It adds the approved name-or-order Tally presence checks and Purchase / Sales / Others / Job Work categories to the supplied V7 platform. No new SQL is required for an existing V7 database. Earlier behavior described below is historical where it conflicts with the V8.1 guide.

# SVMA AI Intelligence Platform V5 - Industrial Glass, Quality Controls & Finance Reconciliation

> **V5 final package (11-Sep-2026):** Start with `RELEASE_V5_FINAL.md`, `SQL_EXECUTION_ORDER_V5.md`, and `V5_TEST_RESULTS.md`. V5 intentionally upgrades the Finance reconciliation engine and enforces a new hard rule that data-entry results cannot be submitted or classified for deviation until a visible business-approved target exists. Older Finance/hash-verification sections below describe historical releases and are retained only for audit history.
## Historical V4 baseline - QC Data Entry Realignment

This build re-derives the Quality parameter set from three newly-supplied PDF lab report forms (PK, COPRA, RB) and redesigns the Quality entry screen, dashboard/analytics and Admin parameter-review flow around it. Scope for this round was held strictly to the existing Quality module — Solvent and Finance are untouched. See:

- **[RELEASE_V4.md](./RELEASE_V4.md)** — this round's release notes.
- **[IMPLEMENTATION_NOTES.md](./IMPLEMENTATION_NOTES.md)** — §6 covers this round; earlier sections cover the V3 Operational Intelligence pass underneath it.
- **[QUALITY_MAPPING.md](./QUALITY_MAPPING.md)** — §8 covers this round's PDF-derived parameter set (83 rows, 20 flagged for review); earlier sections cover the V3 workbook import it supersedes.
- **[UI_REDESIGN_NOTES.md](./UI_REDESIGN_NOTES.md)** — this round's Quality entry-grid, dashboard-rollup and Admin-review redesign, plus the four earlier full-app visual rounds.
- **[NOTIFICATION_FLOW.md](./NOTIFICATION_FLOW.md)** — capture → validate → alert → act → interpret, end to end (V3, unchanged this round).
- **[ENTRY_IMMUTABILITY.md](./ENTRY_IMMUTABILITY.md)** — the lock mechanism and the amendment workflow (V3, unchanged this round).
- **[UAT_TEST_RESULTS.md](./UAT_TEST_RESULTS.md)** — the acceptance tests from the V3 brief, run against that build.
- **[FINANCE_LOGIC_VERIFICATION.md](./FINANCE_LOGIC_VERIFICATION.md)** — Finance/reconciliation logic is unchanged and hash-verified, again, for this round.

> **Behance-aligned redesign pass (V2 rounds) and V3 Operational Intelligence (unchanged in this delivery except as documented above).** The shell, dashboards, admin screens and ticket workflow were re-styled to a flatter, more restrained SaaS visual language in V2, and V3 added immutable entries, TARGET_MISSING, real-time alerts and Quality SLA tracking. This round adds a new, visually-consistent "V8" CSS layer (the Quality entry grid, review-flag banner/pill) appended to `app/globals.css` — nothing from V1–V7 was edited or removed.

## Setup & verification commands

```bash
npm install
npm run verify   # tsc --noEmit && next build — must complete with no errors
npm run dev      # local development server
```

No `.env.local` variable names changed — copy `.env.example` to `.env.local` and fill in your own Supabase/OpenAI values as before; nothing is hardcoded and no secret is exposed to client code.

## Product structure

After login, users land on a role-aware Home page. Only authorised module cards are shown:

- **CEO Cockpit** – consolidated executive Solvent + Quality intelligence, with Finance visibility where authorised.
- **Solvent Production & Safety** – Solvent Head/management Reports, AI Inference, Analytics, Deviation Register and Action Tickets.
- **Quality Intelligence** – Quality Head dashboard, metric analytics, AI inference, reports, deviations and tickets.
- **Finance** – Transaction Reconciliation and Vendor Payment Reconciliation as two independent controls; V2.3.1 logic is unchanged.
- **Solvent Parameter Input** – operator-facing Solvent shift workspace for hourly parameters, shift safety inspection and Boiler.
- **Quality Data Entry** – separate Quality/Lab entry workspace driven by the active product and sampling schedule.
- **Administration** – Super Admin only; users, module access, parameters/targets and shifts.

Business screens intentionally do not expose infrastructure/provider names. The application footer uses **Powered by AIX3**.

## Finance 1 – Transaction Reconciliation

Purpose: **For every transaction in the daily Weighment Register, identify the corresponding Gate record and answer whether the resulting PO/SO is present in Tally.**

Rules:

- Weighment is always the master list.
- Extra Gate rows are ignored.
- Each Gate row can be consumed only once.
- Vehicle number is normalised before matching.
- Material and party are used as tie-breakers for repeated vehicles.
- Only the Gate row linked to a Weighment can become Purchase/Sales/JW/Supply output.
- Internal group parties are separated as Internal Job Work.
- Dates are detected automatically from the source files.
- PO/SO truth is the exact normalised Tally Day Book **Vch No.**.
- A Gate transaction later than the uploaded Tally coverage is **NOT VERIFIED**, not incorrectly marked missing.
- Similar Tally rows are shown only as internal review candidates; they never become the main match unless the exact PO/SO is present.
- AI Review is plain-English running commentary. It cannot change a deterministic YES/NO result.

### Reference benchmark for the supplied September files

These values are **not hardcoded**. They are regression expectations for the exact files under `reference-samples/`:

- Weighment rows: **55**
- One-to-one Gate matches: **52**
- Gate match required: **3**
- Purchases: **15**
- Purchase found in Tally: **14**
- Purchase not found: **1** (`CO-PO/108/25-26`)
- Sales: **18**
- Sales found in Tally: **14**
- Sales not found within Tally coverage: **3**
  - `DORB-SO/00283/26-27`
  - `OIL-SO/00490/26-27`
  - `DOC-SO/00110/26-27`
- Sales outside uploaded Tally coverage: **1** (`OIL-SO/00502/26-27` dated 02-Sep while the supplied Tally file ends 01-Sep)
- Internal Job Work: **7**
- Supplies: **12**
- External Job Work: **0**

The Tally date parser preserves the Excel calendar date directly so the supplied Day Book correctly resolves to **24-Aug-2026 through 01-Sep-2026**.

## Finance 2 – Vendor Payment Reconciliation

This process is completely independent from Weighment and Gate reports and uses only:

- Credit / Debit Note List (purchase rows)
- Tally Day Book

The Credit / Debit Note is the master population. The app reads `LotNumber` from column **H**, extracts the six-digit sequence (for example `RB-R/082205/26-27` → `082205`) and searches that sequence in Tally Day Book column **C** inside `Agst Ref` rows. Payment is confirmed only when the containing Tally voucher has **Vch Type = Payment** and the vendor also matches.

SVMA payable formula:

`AJ + 5% GST - (AK + AL) - AB - AC`

Implemented as:

`BillValue * 1.05 - (Rebate Value + Rebate IGST Amount) - Weightment - Unloading`

The Tally Payment header Debit Amount in column **I** is kept as the voucher total. If the Payment voucher contains multiple `Agst Ref` Lots, the exact child Lot allocation is used for the individual Lot comparison so the full voucher Debit is not duplicated across each Lot.

The output shows: source formula components, calculated payable, Tally column-C reference, Vch Type, Vch No., voucher Debit total, Lot allocation, paid amount, difference and status (`RECONCILED`, `SHORT PAID`, `EXCESS PAID`, `NOT PAID`).

## Quality + source-accurate shift capture

- `E) LAB ANALYSING REPORT` is a separate **Quality Data Entry** module, not Solvent input.
- Quality Head receives a separate **Quality** module with dashboard, metric analytics, AI inference, reports, deviations and action tickets.
- Solvent categories and repeated source S.No. values are retained from the uploaded 30-page source PDF.
- Thermic Fluid Boiler continues across PDF pages 25–26 through source S.No. 18.
- Completed Solvent and Quality shifts can be downloaded by the relevant head as source-structured Excel workbooks.


## Solvent Production & Safety

This is the management/intelligence module. It no longer contains operator input screens.

It includes:

- **Reports** – stored hourly, shift and daily operating reports.
- **AI Inference** – separate management view for:
  - What went well
  - What needs attention
  - What can be done better
  - Production insights
  - Safety insights
  - Trend signals
  - Management actions
- **Analytics** – target compliance, data timing, warnings/critical readings, deviation and ticket health.
- **Deviation Register** – all target/condition deviations.
- **Action Tickets** – Raised → Acknowledged → In Progress/Waiting → Evidence → Resolved/Closed.

AI does not decide whether a value is outside target. Threshold/condition validation happens first; inference only interprets the validated facts.

## Safety & Parameter Input

This is the operator module.

- A shift remains active until its configured end time.
- Submitting a section does **not** end the shift.
- Hourly operating parameters are mandatory for each applicable hour.
- Shift safety/visual checks are separate and entered once per shift where applicable.
- Boiler remains a dedicated workspace.
- Tablet UI follows the familiar operating-sheet pattern: **Parameter | Target | hourly columns | Comment**.
- Only the selected/current hour is editable while prior values stay visible.
- Every save records actual submission time and validates the target immediately.
- Warning/critical deviations create notifications; configured critical deviations create action tickets.
- Operational inference is refreshed after online submissions.
- Temporary offline entries are queued and synchronised when connectivity returns.

Shift focus/lock applies only to operator/safety roles. Super Admin, Admin, CEO, Management and Solvent Head are not trapped by a test/management shift.

## Administration – Super Admin only

The application can now manage master data without routine SQL work:

- Create users directly.
- Assign role, department and designation.
- Assign module access per user.
- Disable/enable users and change access.
- Create new Solvent/Boiler sections and parameters.
- Configure target, unit, input type, frequency, mandatory flag, warning/critical thresholds, alerts and critical-ticket behaviour.
- Edit existing parameters/targets.
- Add, edit, enable or disable shifts.
- Changes are written to the audit trail.

### Module IDs

- `ceo`
- `solvent_management`
- `finance_transaction`
- `finance_vendor_payment`
- `input`

Administration itself is always Super Admin only and cannot be granted as a normal module permission.

## Existing V2.3/V2.3.1 database – run this once

Before starting V2.4 against the database you have already been using, run only:

```text
sql/000_RUN_THIS_NOW_V2_4.sql
```

This adds product-aware shift/parameter fields and the new Quality intelligence access. Finance reconciliation tables are intentionally untouched.

## Fresh database

For a brand-new project run:

```text
sql/001_schema.sql
sql/002_seed.sql
sql/005_v2_parameter_expansion.sql
sql/006_source_target_validation.sql
```

Then create the first authentication user and use `sql/003_first_admin.sql` after replacing the placeholder email/user reference as described in that file.

## Environment

Copy `.env.example` to `.env.local` and populate the server/application credentials there. Never put secret keys into browser code or commit them to source control.

## Windows install / run

```cmd
npm install
npm run build
npm start
```

Open:

```text
http://localhost:3000/login
```

## Suggested end-to-end UAT

1. Run `sql/000_RUN_THIS_NOW_V2_4.sql` on the existing V2.3/V2.3.1 database.
2. Login as Super Admin and confirm the module-card Home page.
3. Administration → create a Finance test user and grant only Transaction Reconciliation; confirm Vendor Payment is not exposed to that user.
4. Administration → create a Solvent Operator with only Safety & Parameter Input.
5. Administration → add one temporary hourly parameter and one shift-safety parameter; confirm they appear in the correct input workspace.
6. Finance → Transaction Reconciliation → upload the supplied Weighment, Gate In, Gate Out and Tally files; compare against the benchmark above.
7. Finance → Vendor Payment Reconciliation → upload Credit/Debit + Tally; compare against the benchmark above and inspect the 12 payment allocations.
8. Safety & Parameter Input → start a shift and enter an in-target reading; confirm normal validation and updated inference.
9. Enter a warning/critical test reading; confirm notification/deviation and critical ticket creation where configured.
10. Solvent Production & Safety → verify Reports, AI Inference, Analytics, Deviation Register and Action Tickets are separate.
11. Action Tickets → acknowledge, save investigation/corrective action, upload evidence and resolve the ticket.
12. CEO Cockpit → verify it reflects the latest Finance and Solvent information without exposing operator input controls.

## Reference source files

`reference-samples/` contains the supplied UAT source files:

- `WeighmentRegister (1).Xls`
- `Gate In EntrySVMAAdmin20260902051234PM.xlsx`
- `Gate Out EntrySVMAAdmin20260902051255PM.xlsx`
- `Tally Daybook.xlsx`
- `Credit_Debit Note ListSVMAAdmin20260902051421PM.xlsx`
- `SOLVENT & BOILER.pdf`

The old SVMA ZIP is not used as a source of business logic.


## V2.4.1 build patch
This package includes the TypeScript build fixes documented in `RELEASE_V2_4_1.md`. No additional SQL is required if V2.4 SQL has already been applied.

## V2.4.4 data-entry UAT
Solvent and Quality data entry now use a simple source-sheet table. Hourly/scheduled entries and one-time shift entries are separated. Finance reconciliation logic is unchanged from V2.4.3.
