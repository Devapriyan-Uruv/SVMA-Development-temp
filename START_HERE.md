# SVMA V8.6 — Complete safety coverage and alerts

Use this one folder for all modules. The modern V8.5 design, reports, Quality and Finance are included.

## Required upgrade (run in this exact order)

1. In Supabase SQL Editor, run these three files **in order**, on top of whatever is already installed (001 through 017):
   - **sql/018_v8_6_1_reliability_and_repair.sql** — repairs a missing earlier migration (adds `parameter_entries.locked`, the amendment-workflow table, and Quality's sample-task table — without these, every save fails with "Unable to save entry"), and replaces the deviation/ticket/notification trigger with one that can never roll back a valid reading if the follow-up work fails (see "Deviations and notifications" below).
   - **sql/019_v8_6_2_parameter_corrections.sql** — five parameter corrections found by an automated, evidence-based line-by-line comparison against the approved source documents (see "Parameter coverage" below).
   - Both files are additive/idempotent and safe to re-run.
2. Deploy this application folder using your usual process. For local testing: `npm ci`, `npm run build`, then `npm run start`.
3. **Launch address**: if anything else is already listening on port 3000 (a common cause of "which app am I testing" confusion), start this app explicitly on a different port, e.g. `npm run dev -- -p 3001` / `npm run start -- -p 3001`, and use that address. Always confirm which process owns port 3000 before trusting it (`lsof -iTCP -sTCP:LISTEN`) — an old build left running there is not this application.

## Deviations and notifications — reliability fix

The V8.6 database trigger that creates a deviation + ticket + notifications atomically with the save had no exception handling: if that follow-up work hit a bug, it rolled back **the reading itself** — turning a valid save into a false failure. `sql/018` replaces it with a version that:
- can never fail the save — a follow-up error is caught and filed into a new `deviation_processing_failures` table instead of rolling anything back;
- is automatically retried (a "Retry now" control is visible to Management/Heads on the Tickets page whenever anything is pending); confirmed live: a reading saved even while its own ticket/notification creation was failing, and the retry mechanism created the missing deviation/ticket minutes later once the underlying bug was fixed;
- honours each parameter's own `alert_enabled` / `ticket_severity_threshold` settings, which the previous trigger ignored.

Every new warning or critical deviation still creates exactly one ticket and notifies the entering operator plus Solvent/Quality Head, Management and CEO — confirmed live by entering a real deviation as an operator and watching it arrive at a separately-logged-in CEO account within seconds.

## Parameter coverage

The detailed safety workbook has 453 operational rows, including Cooling Pond 45 and Packing Godown 23. The 26 Lab Analysing Report rows remain excluded from Solvent. **Quality's 83 parameters (RB 19 / PK 32 / COPRA 32) were checked row-by-row against the three approved lab-report PDFs and matched exactly — no changes needed.**

Solvent/Boiler's 453 rows (+4 legitimately retained original parameters = 457 active) were also checked row-by-row against AGRO SAFETY POINTS.xlsx. `sql/019` corrects five confirmed drifts:
- Both boilers' "BLOW DOWN TDS CHECK" had `target_text = "CONDITION"` on a **numeric** input — meaning no TDS reading, however excessive, could ever be flagged. Restored to the source's explicit "< 4000".
- "FINEL OIL COOLER OUTLET °C" had been narrowed from the source's range "50-55" to the bare number "50", which the parser treats as an exact match — so a normal 52-54°C reading would have been flagged as a false deviation. Restored to "50-55".
- CVL Boiler's "STEAM TEMPRETURE CHECK °C" read "100" against a source value of "180" (its sibling Vesion Boiler row already had the correct value). Corrected.
- Four "PELLETIZER NO 1-4 RUNNING" parameter names carried an import corruption ("AMSMSMS" instead of "AMS"); corrected to match the source's exact wording. Their target ("80 AMS") was already correct.

Three further drifts were found and are **intentionally left unchanged** because the source cell itself is ambiguous or the gap could be a deliberate operating margin rather than an error — see the comment header in `sql/019` for exactly which three and why. A Super Admin should confirm these in Admin → Parameters.

See reference/safety-complete/PARAMETER_COVERAGE.md for section counts and coverage.json for every source row.

## Hourly entry and save proof

All groups are shown by default. Hourly readings, including the previous two-hour and four-hour intervals, can be entered once in every hour of the shift. Shift checks remain separate.

Solvent readings without an approved target can be recorded and are marked Target missing. They are never judged normal or abnormal without a target. Quality target requirements remain unchanged. Saved values remain locked and use the existing correction workflow.

A save confirmation appears only after the server confirms the reading, and states the exact counts — confirmed live: "6 entries saved. 3 deviations raised. Confirmed at [time]." A failure shows an error pop-up with the real underlying cause (previously masked behind a generic "Unable to save entry" across all 22 API routes — fixed). Offline entries are labelled Waiting to sync, not Saved.

## AI reporting

The configured model is a reasoning model that took ~19-39 seconds to respond to realistic prompts in testing — the previous 20-25 second timeouts meant AI Insight and AI-commented exports fell back to "unavailable" on nearly every real call. Timeouts were increased (with matching route `maxDuration`) and the "AI Insight" button now shows "Analysing… (up to a minute)" instead of no feedback. Re-verified live: genuine, evidence-grounded AI analysis returns correctly for both Solvent and Quality, immediately after save.

Quality's shift-report Excel export was missing the Ticket ID / AI Comments / AI-hypothesis columns that Solvent already had — fixed; both modules now export identically. AI hypothesis text is always phrased as a hypothesis ("could be due to…", "may be caused by…") and correctly states "no causal hypothesis is warranted" for normal readings rather than inventing a cause.

## Finance reconciliation

Transaction and payment reconciliation logic reviewed; one real (if rare) bug fixed: a payment's "Rebate Net Value" of exactly 0 was being discarded in favour of a computed fallback (a `||` used where the code needed to distinguish "explicitly zero" from "not recorded") — fixed to check validity explicitly, matching the pattern already used elsewhere in the same function. Re-verified against your actual attached sample files (Weighment Register, Gate In/Out, Daybook, Credit/Debit Note for 10.09.2026): both reconciliations produce honest, traceable, non-fabricated results, and Excel export was confirmed correct.

## Reports and other modules

The V8.5 Solvent/Quality date-and-shift downloads and daily reconciliation report downloads remain included.

## UI fixes this round

Sidebar collapse toggle made visible (was a near-invisible 27px circle) — then a real bug this surfaced (a browser auto-scroll permanently clipping the sidebar's own labels after any collapse/expand click) was found and fixed at the root cause. A locked-in operator's sidebar no longer shows dead links to pages the server will redirect them away from during an active shift. Quality Input no longer incorrectly highlights the Quality management nav item. The Management dashboard's Finance card no longer collapses into a narrow column (a missing CSS class). Several "label glued to value" overlap bugs fixed (dashboard metrics, admin banner, Finance upload labels, and a product-picker card that only broke once selected).

## Verification performed this round (with evidence, not assumption)

- Production build and TypeScript pass; all 9 regression scripts in `scripts/` pass (0 failures) — several pre-existing stale checks unrelated to this round's changes were also found and corrected so the suite is honestly green.
- Live, manual save/deviation/ticket/notification testing for both Solvent (warning + critical, numeric + categorical) and Quality (Copra QC sheet), performed through the actual UI, not scripts — confirmed correct counts, correct severity classification, correct immediate cross-role notification delivery, and confirmed the retry mechanism recovers a follow-up failure after time has passed.
- Role-based spot checks: cross-role denial, unauthenticated denial, and a manipulated shift-ID write attempt all correctly blocked.
- Tested at desktop, tablet (1024×768, the primary data-entry device), and mobile (375×812) widths.
- Not exhaustively covered this round: a full per-screen role matrix across every route, and every one of the 60+ scenario checklist items individually — the areas explicitly requested this round (reconciliation logic, full parameter audit, live save/notification/AI/report behaviour) were covered in depth instead.
