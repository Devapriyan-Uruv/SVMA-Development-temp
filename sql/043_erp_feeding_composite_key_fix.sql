-- Fix discovered by live-testing against the real Feeding Details.xlsx file
-- (not caught by structural review alone): "Reference No" is a SHIFT-level
-- identifier, not a per-row one — the exact same reference_no genuinely
-- repeats across every lot/product fed in that shift (confirmed: two real
-- rows both carry "FG_01421092026Shift3", one for BrokenRice/lot
-- BR/091407/26-27, the other for RICEBRAN-Grade I/lot RB-G1/091307/26-27).
-- sql/041 wrongly made reference_no UNIQUE on its own, so the second real
-- row in the very first live upload failed with a unique-violation. The true
-- per-row business key is (reference_no, lot_no) — matches the original
-- spec's own suggested Feeding key (report_date+reference_no+lot_no+shift+
-- time_slot) once lot_no is added; report_date/shift/time_slot are already
-- constant for a given reference_no in every real file inspected, so
-- (reference_no, lot_no) alone is sufficient and matches the exploded-row
-- pattern already used for erp_production_entries.
alter table public.erp_feeding_entries drop constraint if exists erp_feeding_entries_reference_no_key;
alter table public.erp_feeding_entries add constraint erp_feeding_entries_reference_no_lot_no_key unique (reference_no, lot_no);
