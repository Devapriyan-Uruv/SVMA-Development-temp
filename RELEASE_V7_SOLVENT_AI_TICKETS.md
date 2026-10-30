# SVMA V7 — Solvent Production & Safety

## What changed
- Keeps the V6 Quality/QC master unchanged.
- Solvent Lab Analysing Report is removed from Solvent input; QC remains the lab source of truth.
- Ground Floor starts with authorised-person entry control and entrance-gate position.
- Corrected Cooling Pond targets: Pump-1 = 65 and Pump-2 = 55 (AMS is part of the parameter name, not the target value).
- Corrected Second Floor: Incoming Conveyor 8.5 AMS; Recuperation Manometer -2 mm to +4 mm; explicit 580/518/5218/5278 MM/KG rows; Vacuum Pump 20 AMS.
- Preparatory pelletizer current uses AMS.
- Canonical spellings: Palvarizer Godown and Vesion Boiler.

## Deterministic target rules
AI never decides compliance. V7 supports strict `>`, `>=`, `<`, `<=`, inclusive numeric ranges (including signed ranges such as `-2 mm - +4 mm`), exact numeric targets, and categorical states such as CLOSED, AUTHORISED PERSON, NIL, NO LEAK, AVAILABLE and CLEAN.

Examples:
- `>100`, actual `90` => deviation.
- `>100`, actual `100` => deviation (strict greater-than).
- `<12`, actual `12` => deviation (strict less-than).
- `55-75`, actual `54` => deviation.
- `65`, actual `57` => deviation.

## Automatic tickets
Every Solvent/Boiler deterministic warning or critical deviation creates a deviation record and an action ticket. Notification delivery remains configurable, but ticket creation does not depend on AI.

## Completed-shift Excel report
Each Solvent section includes:
- Parameter / Unit
- Target
- Sampling
- 8 shift-hour columns
- Shift Actual (for once-per-shift checks)
- Deterministic Status
- Ticket ID
- AI Comments
- Why this might have arisen (AI hypothesis — not confirmed root cause)
- Operator Comments

AI may describe patterns and suggest possible causes. It cannot change readings, targets, status, severity or ticket state. If OpenAI is not configured/unavailable, export still works using deterministic fallback comments.

## Database
For an existing V6 database, run `sql/000_RUN_THIS_NOW_V7.sql` once in Supabase SQL Editor.
