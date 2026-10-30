# Quality Mapping — `LAB REPORTS AI 1.xlsx` → `parameter_master`

This document is the required, explicit record of how the attached Quality workbook was turned into the 79-row import in `sql/011_v3_quality_full_import.sql`. It supersedes the old assumptions baked into `009_v2_4_product_intelligence.sql`'s hand-typed Quality list — this round re-derived the mapping directly from the workbook, sheet by sheet, cell by cell, with a generating script kept for reproducibility (`/home/claude/work/inspect/gen/build_quality_import.py`, not shipped in the app — a one-time data-migration tool).

## 1. Sheets and confirmed column mapping

The workbook has three product sheets. Each sheet's header row (row 1 or row 2, sheet-dependent) was read directly with `openpyxl`, and every candidate column was checked against its actual header text and a sample of data rows before being accepted — nothing here is guessed from column position alone.

| Sheet name    | Product code | Spec/target column | Sample-frequency column | Result-SLA column |
|---------------|:------------:|:-------------------:|:------------------------:|:-------------------:|
| `E & NE COPRA`| `COPRA`      | **K**                | **P**                     | **Q**                |
| `RB`          | `RB`         | **O**                | **M**                     | **N**                |
| `PK-`         | `PK`         | **K**                | **P**                     | **Q**                |

Each sheet's own header row confirms these letters — the three sheets are laid out differently (RB's spec column is not in the same position as the other two), which is exactly why each was inspected individually rather than assumed to share one layout.

## 2. Row scan rules

- Data rows are scanned from row 4 onward (the sheets have multi-row headers above that).
- **Product/group name (column A)** is forward-filled: a non-empty column-A cell starts a new group and applies to every following row until the next non-empty cell. Rows whose column-A text matches `LIMIT` or `MOISTURE DIFFERENCE` (case-insensitive) are treated as **artifact/footer rows**, not a real group name, and are skipped for the purposes of forward-fill (the previous real group continues to apply).
- **Shift duplication.** Each sheet repeats its full parameter list once per shift (Shift I, Shift II, Shift III) as three near-identical blocks. The scan stops at the first row whose column-A text matches `SHIFT\s*-?\s*I{2,3}\b` (i.e. "SHIFT II" / "SHIFT-III" / "SHIFT III") — only the **first block (Shift I)** is used as the master parameter list, since it is the same parameter set for every shift; the master list is shift-independent and shift-specific sampling is handled separately via `shift_sessions` + `quality_sample_tasks`, not by importing the same parameter three times.
- A row with no parameter name (column B empty) is skipped.
- A row with a parameter name but no group established yet is skipped and logged (none occurred in this workbook — logged for defensiveness, not because it happened).

## 3. Why this is a full re-derivation, not a patch on `009` — verified row-by-row

`009_v2_4_product_intelligence.sql` already hand-typed 87 Quality rows with a substantially correct product/group structure — including the `EDIBLE COPRA CAKE` / `NON-EDIBLE COPRA CAKE` split, which direct inspection confirms **is a real, literal value in column A** (row 4 alone reads `EDIBLE COPRA CAKE`; row 5 starts a new literal group `NON-EDIBLE COPRA CAKE` that forward-fills through rows 5–8 — no merged cell needed, it's a plain per-row column-A value). This split is correctly reproduced by the new import too — it is **not** a point of divergence.

A row-by-row comparison of `009` against the freshly-derived `011` set (matched on product + parameter name + group) instead found these real differences, which is why this round re-derived the full list directly from the attached workbook rather than reconciling `009` cell-by-cell:

- **`009` left `target_text` null for roughly half its 87 rows** — the parameter/group/frequency structure was there, but no usable spec value. `011` populates a real, workbook-sourced `target_text` for nearly every row (64 of 79; the rest are genuinely blank in the source or intentionally categorical).
- **A handful of `009`'s populated numeric ranges differ from the currently-attached workbook.** For example `009` has DORB `% MOISTURE` as `11-12`; the attached `LAB REPORTS AI 1.xlsx` reads `10.5% - 11.5%` for the same cell. Similar shifts appear for DORB `% FIBER` (`12-13` vs `10.5% - 13.5%`) and `% PROTEIN` (`14-15` vs `14.5% - 16%`). Since `009` predates this attachment and its source/provenance for those exact numbers can't be confirmed, `011` treats the attached workbook as authoritative and takes its values, rather than trying to guess which of the two is "correct."
- **Literal source text is preserved exactly, including apparent quirks in the current workbook**, rather than normalised or corrected: the group is imported as `PALM KERNAL CAKE` (as the sheet actually spells it), not the corrected `PALM KERNEL CAKE` spelling `009` used; `NICE- 1` / `NICE- 2` (no space before the dash) is imported as written, not `009`'s `NICE - 1` / `NICE - 2`. This is a deliberate choice — Section F says "preserve source text... never invent meaning," which applies to spelling and spacing exactly as much as to numeric bounds.
- **Genuinely ambiguous cells are flagged, not guessed.** Where a single spec cell encodes two different sub-product limits at once (e.g. `E - B 5 % & NE -AB.-10 %`, mixing Edible and Non-Edible thresholds in one field) or reads `OOS`, the row is imported with its raw spec text preserved and `source_review_required = true` set — `009` either left the same cell null or silently carried a single guessed number. 16 of 79 rows in `011` are flagged this way (see §7).

`011_v3_quality_full_import.sql` **deactivates every existing `quality`-module `PROCESS LAB REPORT` row from `009`** before inserting the freshly-derived set, so the two lists never coexist and there is exactly one authoritative Quality parameter definition per row at any time.

## 4. Target/spec parsing (`target_text`, `input_type`, `options`)

- If the spec cell's text (case-insensitive, trimmed) is exactly `NIL`, the parameter is imported as **categorical** (`input_type: 'select'`, `options: ["NIL","PRESENT"]`, `target_text: null`, `unit: null`) — this matches how the workbook itself uses the word (a presence/absence check, not a numeric limit). A unit is never attached to a categorical row (an earlier pass mistakenly inherited a `°C`/`%` unit from a keyword match on the parameter name for e.g. `DT FLASH`; this was caught and corrected before the final SQL was generated).
- Every other cell is imported as **numeric** (`input_type: 'number'`) with its exact spec text preserved verbatim in `target_text`. The **runtime** parsing of that text into a usable low/high bound happens at read time via `lib/targetParser.ts` (`parseTargetBounds`), which is documented in full in that file's own header comment and is unit-tested indirectly through the UAT scenarios in `UAT_TEST_RESULTS.md`. In summary, it recognises: numeric ranges (`A - B`), `<`/`>` symbols, and the plain-English directional words the new workbook actually uses — `BELOW`, `MAX.`/`MAXIMUM`, `UP TO`, `NOT MORE THAN`, `NOT EXCEEDING` (all treated as an upper bound), and `ABOVE`, `MIN`/`MINIMUM`, `NOT LESS THAN`, `AT LEAST` (all treated as a lower bound). It never invents a bound for text it cannot parse cleanly — a bare number with no directional word, `OOS`/`N/A`, or a cell mixing two sub-product branches (E & NE) is flagged `ambiguous: true` and is not used to auto-flag a deviation; the raw text is still shown and still preserved, exactly as Section F requires.
- A row is flagged `source_review_required = true` at import time (independent of the runtime parser above — this flag is about the **source cell**, for a Super Admin reviewing the imported list) when the spec cell is: empty/blank, a bare number with no unit or direction, `OOS`/`N/A`/`NA`, contains an E/NE multi-branch split, or contains two separate numbers in the same cell (a likely data-entry artifact in the source workbook, e.g. a stray duplicated figure).

## 5. Sampling-frequency → `sample_frequency` / due-time calculation

The workbook's "TIME FOR PROVIDING SAMPLE" column is free text with real, observed inconsistencies (extra spaces, duplicated words). `lib/slaParser.ts` (`parseSampleFrequency`) normalises it deterministically:

| Source text pattern (case-insensitive, whitespace-collapsed) | Parsed as |
|---|---|
| `ONCE IN A SHIFT`, `ONCE IN SHIFT`, `ONCE FOR SHIFT`, `ONCE A SHIFT`, and the observed typo `ONCE IN A SHIFT SHIFT` (duplicated word — the regex matches on the leading phrase, so the trailing duplicate is harmless) | `oncePerShift: true` → **one** sample task per shift, due at shift start |
| `EVERY <n> HR` / `EVERY-<n> HRS.` / `EVERY <n> HOUR` — including the observed typo `EVERY 4 HR. HOUR` (duplicated word; matched by the same leading-phrase regex) | `everyMinutes: n × 60` |
| `EVERY HOUR` (no explicit number) | `everyMinutes: 60` |
| anything else / empty | `everyMinutes: null, oncePerShift: false` (no task generated — logged, not guessed) |

Given a shift's actual start/end time (from the active `shift_sessions` row), `generateSlotStarts()` produces the exact list of expected sample times for that shift — hourly slots for `EVERY 1 HR`, one slot every 4 hours for `EVERY 4 HR`, or a single slot at shift start for once-per-shift — and a `quality_sample_tasks` row is created for each slot × active product when the shift session opens (or when its active-product list changes). `sample_due_at` is exactly that slot time; a sample becomes **overdue** when `now > sample_due_at + parameter_master.sample_grace_minutes` (Super-Admin-configurable per parameter, default 15 minutes).

## 6. Results-available SLA → `result_latency_minutes` / `result_due_at`

The workbook's "RESULTS WHEN AVAILABLE" column is parsed by `parseResultSlaMinutes()`, tolerant of the specific typos actually observed in this file:

| Source text pattern | Parsed as |
|---|---|
| `AFTER 1.5 HR. FROM THE SAMPLE COLLECTION` | `90` minutes |
| `AFTER 1.5 HR. FROM THE NSAMPLE COLLECTION` (observed typo — stray leading "N" on "sample") | the parser first replaces `NSAMPLE` → `SAMPLE`, then parses identically to the row above → `90` minutes |
| `AFTER 45 MTS.` / `5 MTS.` | `45` / `5` minutes (matches `M(T|IN)` so both `MTS` and `MIN` forms work) |
| a bare number with no unit | that number, treated as minutes |
| unparseable / empty | `null` (no `result_due_at` is set for that task; it is never treated as overdue) |

`result_due_at` is set the moment a sample is marked received (`PATCH /api/quality/sample-tasks`): `result_due_at = sample_received_at + result_latency_minutes`. A result becomes **overdue** when `now > result_due_at` and no result has been submitted yet. When an operator later submits the actual lab reading through the normal entry form, `app/api/entries/route.ts` automatically finds the open task for that shift/parameter/product and sets `result_submitted_at` + links the `entry_id` — closing the loop without a separate "close this task" step.

## 7. Import summary

- **79 parameter rows** imported across the three sheets (COPRA, RB, PK).
- **16 rows** flagged `source_review_required = true` (ambiguous/OOS/bare-numeric/multi-branch spec text) — these are visible to a Super Admin in the Parameters admin screen and are intentionally **not** auto-configured with a guessed numeric threshold; they still save and validate (falling back to the runtime `ambiguous` handling in §4), they simply don't yet drive an automatic numeric deviation until a Super Admin sets an explicit bound.
- **0 rows** could not be parsed at all (no parameter dropped for lack of a group, etc.).
- Every imported row's `parameter_master` record carries `source_file = 'LAB REPORTS -AI(1).xlsx'` so it can always be traced back to the exact workbook and is distinguishable from any historical hand-typed row.

## 8. Round 6 / V4 — full re-derivation from the three lab-report PDFs (PK, COPRA, RB)

You supplied three new source documents — `PK_LAB_REPORTS.pdf`, `COPRA_LAB_REPORTS.pdf`, `RB__LAB_REPORTS.pdf` — one per product, each laid out as three near-identical shift blocks (Shift I / II / III) with the same parameter list repeated under different hour-column headers. Exactly as with the `011` xlsx import, **Shift I is the master parameter list**; Shift II/III were read in full to confirm they are the identical set (they are) and were not re-imported as separate rows.

**What changed vs. the `011` import, and why this is a re-derivation, not a patch.** These PDFs are a different, more current source document than the `LAB REPORTS -AI(1).xlsx` workbook `011` was built from. Direct comparison against `011`'s own SQL turned up two verified, concrete differences (checked by grep against `sql/011_v3_quality_full_import.sql` before writing this section, not assumed):
- **`MOISTURE DIFFERENCE` (`LIMIT < 1 %`) is a new parameter for all three products** — `011` has zero rows containing that text; the new PDFs carry it for PK, COPRA and RB alike, each under `ONCE IN A SHIFT`.
- **`FLASH POINT` is modeled differently, not changed in substance.** In `011`, all three products' FLASH POINT row folded the numeric threshold into the parameter *name* itself (`'FLASH POINT ( UPTO 120* )'`) and stored it as a purely categorical NIL/PRESENT check with no separate parseable target. The new PDFs' own cell text — `> 120* NIL` / `< 120* NIL` — separates the two: an actual comparison (`> 120` / `< 120`) plus a trailing `NIL`. V4 preserves that distinction faithfully (see below) rather than re-flattening it back into a name-embedded categorical, so the numeric threshold is now a real, parseable target for the first time — at the cost of the row needing a human to confirm what the trailing `NIL` means (this round's review flag, not a regression).

Individual numeric targets differ for a number of rows between the two sources (e.g. PK `% MOISTURE` is `5 - 8` in the new PDF), which is expected for two source documents produced at different times — this transcription does not attempt to reconcile or explain each individual figure's history, it transcribes the newly-supplied PDF faithfully, exactly as `011` did for the workbook before it. Rather than diff the two sources cell-by-cell against an unclear provenance, `sql/012_v4_quality_report_realign.sql` follows the same non-destructive pattern `011` used against `009`: it **deactivates** every currently-active Quality `PROCESS LAB REPORT` parameter (`active=false`, historical `parameter_entries` untouched — they stay FK-linked to the now-inactive `parameter_id` and remain fully visible in shift history/reports) and **upserts** the freshly-transcribed set as the new active generation. At no point are two active definitions of the same parameter live at once, and no past reading is ever deleted, edited, or reassigned.

**Row counts.** 83 parameter rows imported: **PK 32, COPRA 32, RB 19**. 20 rows (24%) are flagged `source_review_required = true` — visible in Admin → Parameters behind the new "needs review" banner (§ below) — for one of two reasons, both judgment calls made the same way as `011`'s bare-number rule:
- **A bare number with no comparison symbol, range, or directional word** (e.g. PK `% OIL` reads simply `15`, COPRA `RECUPERATION HOT OIL` reads `1.5`). The deterministic parser (`lib/targetParser.ts`) still exact-matches the reading against that number, but whether `15` means "target exactly 15," "maximum 15," or "minimum 15" isn't stated in the source cell, so nothing is guessed — a Quality Head/Super Admin confirms the intended direction and can add a symbol (e.g. `< 15`) in the Admin edit drawer once confirmed.
- **The `FLASH POINT` rows** (`PK OIL`, `COPRA OIL`, `RB OIL`) read as e.g. `> 120* NIL` / `< 120* NIL` in all three source PDFs. The numeric comparison (`> 120`, `< 120`) parses and validates normally — `lib/targetParser.ts`'s `>`/`<` match is not anchored to end-of-string, so the trailing text doesn't break it — but the trailing `NIL` is a second, unexplained criterion layered onto the same cell (possibly "no visible residue at the flash-point reading," possibly a transcription/formatting artifact in the source PDF itself). Rather than silently drop it or silently treat the row as a NIL/PRESENT categorical (which would discard the numeric bound the source clearly does also specify), the full raw text is preserved verbatim in `target_text` and the row is flagged for a human to confirm what the compound criterion means.

**`DT FLASH` stays categorical, unchanged from `011`'s rule.** `PK DT` and `COPRA DT` both have a `DT FLASH` row whose spec cell is the bare word `NIL` (no numeric part at all, unlike the `FLASH POINT` rows above) — these import as `input_type: 'select'`, `options: ["NIL","PRESENT"]`, exactly as §4 above already specifies for an exact `NIL` cell.

**Units.** Unit inference follows the same keyword-on-name heuristic `011` used (`%` for MOISTURE/OIL/FFA/FIBER/PROTEIN/S&S/WAX/GUM/SEDIMENT/SHELL/DEFECT parameters, `°C` for FLASH POINT, `UNITS` for a COLOUR reading, none for IV or a categorical NIL/PRESENT row) — re-applied fresh against each new parameter name rather than carried over from `011`, so a renamed or newly-added parameter still gets a sensible unit.

**Sampling frequency and result SLA.** Every frequency and SLA string in the three PDFs (`Every 4 hr.`, `Every Hour`/`EVERY HOUR`, `Every 2 hr.`, `ONCE IN A SHIFT`, `AFTER 1.5 hr. From the sample collection`, `3 mts.` / `2 mts.`, `8 hrs`, etc.) was checked directly against `lib/slaParser.ts`'s existing patterns (§5–6 above) before transcription began, specifically to confirm **zero parser changes were needed this round** — every pattern in the new PDFs is already tolerated by the case-insensitive, whitespace-collapsed matching those functions already do. This is a meaningfully lower-risk round than `011`'s import: the risk surface is the transcribed data, not the parsing engine.

**Result:** 83 rows imported, 20 correctly held for human confirmation rather than guessed, 0 parser changes, 0 rows silently dropped. See `sql/012_v4_quality_report_realign.sql` for the migration and `RELEASE_V4.md` for the full round summary.
