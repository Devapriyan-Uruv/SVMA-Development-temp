# SVMA AI Intelligence Platform V4.0.0 — QC Data Entry Realignment

This release re-derives the Quality parameter set from three newly-supplied PDF lab report forms (PK, COPRA, RB) and redesigns the Quality-module screens that data change touches. Scope was deliberately held to the existing QC data entry — Solvent and Finance are untouched, and no Finance reconciliation logic was touched (see `FINANCE_LOGIC_VERIFICATION.md`). Full detail on every decision is in `IMPLEMENTATION_NOTES.md` §6, `QUALITY_MAPPING.md` §8 and `UI_REDESIGN_NOTES.md`'s Round 6 section.

## What changed

- **The Quality parameter set has been fully re-derived from the three attached PDFs** (`PK_LAB_REPORTS.pdf`, `COPRA_LAB_REPORTS.pdf`, `RB__LAB_REPORTS.pdf`) — 83 rows (PK 32 / COPRA 32 / RB 19), superseding the prior xlsx-derived import the same non-destructive way that import superseded the one before it: the old generation is deactivated, never deleted, and every historical reading stays intact and traceable. 20 rows (24%) are flagged for a Quality Head / Super Admin to confirm — bare numbers with no stated direction, and the `FLASH POINT ... NIL` compound criterion present across all three products — rather than guessed. See `QUALITY_MAPPING.md` §8 for the full rationale, including two verified differences from the prior import (a new `MOISTURE DIFFERENCE` parameter on all three products, and the `FLASH POINT` reading now stored as an actual parseable numeric target instead of folded into the parameter's name).
- **Zero parsing-engine changes.** Every sampling-frequency and result-SLA pattern in the three new PDFs was checked directly against the existing `lib/targetParser.ts` / `lib/slaParser.ts` logic before anything was transcribed, and all of it was already handled — this release carries no changes to either file.
- **The Quality hourly entry screen now mirrors the paper form.** All 8 hour columns are visible per parameter row at once, with live MIN/MAX/AVG and a Comments column, so an operator sees a shift's whole trend without switching hours. Only the active hour's column is ever editable — the entry-immutability guarantees, amendment-only correction workflow and 409 ENTRY_LOCKED behavior from V3 are all unchanged.
- **MIN/MAX now shown alongside the existing AVG** on the Quality dashboard and analytics pages, computed the same way — pure arithmetic over already-loaded readings, nothing new stored.
- **A parameter flagged for review is now visible and actionable in Admin.** `parameter_master.source_review_required` (present in the schema since V1, never previously surfaced) now drives a dismissible banner and per-row pill in Admin → Parameters, and an explanatory notice plus confirm-and-clear checkbox in the parameter edit drawer — for every module's flagged parameters, not only this round's Quality import.

## Database

Run `sql/000_RUN_THIS_NOW_V4.sql` once after V3.0.0 (it is a copy of `012_v4_quality_report_realign.sql`, this round's only migration). The statement is non-destructive — it deactivates the prior Quality parameter generation and inserts the new one; no row is ever deleted.

## Finance

Zero Finance business-logic files were opened for writing this round. See `FINANCE_LOGIC_VERIFICATION.md`'s Round 6 section for the hash-verification evidence.

## Build

`npx tsc --noEmit` and `npx next build` both complete cleanly against this round's changes.
