# SVMA AI Intelligence Platform V3.0.0 — Operational Intelligence

This release is a backend/operational pass over V2.5.0. It is not a visual redesign — no page was restyled and no Finance reconciliation logic was touched (see `FINANCE_LOGIC_VERIFICATION.md`). Full detail on every decision is in `IMPLEMENTATION_NOTES.md`, `QUALITY_MAPPING.md`, `NOTIFICATION_FLOW.md`, `ENTRY_IMMUTABILITY.md` and `UAT_TEST_RESULTS.md`.

## What changed

- **Entries are now immutable once submitted.** A resubmit of an already-captured slot is rejected server-side (`409 ENTRY_LOCKED`), enforced both at the API layer and by a database trigger. The only way to correct a submitted reading is the new audited amendment workflow, restricted to Solvent Head / Quality Head / Super Admin — the original value is never overwritten.
- **A missing target is no longer silently treated as Normal.** It is now a distinct `TARGET_MISSING` status that still saves and still notifies Dept Head, CEO and Super Admin immediately.
- **Deviation thresholds remain fully deterministic** — Super-Admin-configured numeric bounds first, workbook target text as fallback, AI never decides severity — now extended to understand the new Quality workbook's plain-English wording (BELOW/MAX/UPTO/ABOVE/MIN) without ever guessing at genuinely ambiguous text.
- **Real-time, audible, acknowledgement-gated alerts.** Notifications now push over Supabase Realtime, can play a sound and vibrate (gated behind a one-time "Enable Operational Alert Sound" browser control), and a Critical alert stays on screen until explicitly acknowledged. Deduplicated at the database level so a retried submission or a repeated background sweep can never double-notify.
- **Whether a Warning deviation opens a ticket is now Super-Admin-configurable per parameter** (default: yes, same as Critical) instead of hardcoded to Critical-only.
- **Quality sample and result SLA tracking.** Expected sample times are generated from the workbook's own sampling-frequency text when a Quality shift session opens; overdue samples and overdue results are detected and notified automatically, and a submitted result auto-closes its own task.
- **The full Quality parameter list has been re-derived directly from the attached `LAB REPORTS AI 1.xlsx`** (79 rows, replacing the prior partial hand-typed list) — see `QUALITY_MAPPING.md` for the exact column mapping and every parsing rule.
- **Solvent and Quality analytics gained Date / Date range / Product / Severity filters** (plus Shift on Solvent), applied server-side so KPIs, charts and the deviation timeline move together.
- New Admin controls for the two new per-parameter settings: ticket severity threshold, sample grace period.

## Database

Run `sql/000_RUN_THIS_NOW_V3.sql` once after V2.4.x/V2.5.0 (it is the concatenation of `010_v3_operational_intelligence.sql` and `011_v3_quality_full_import.sql`). Every statement is additive and safe to re-run.

## Finance

Zero Finance business-logic files were opened for writing this round. See `FINANCE_LOGIC_VERIFICATION.md` for the hash-verification evidence.
