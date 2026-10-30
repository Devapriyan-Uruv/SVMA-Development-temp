-- SVMA V8.6.2 — Parameter corrections found by a full, automated line-by-line
-- comparison of every active Solvent/Boiler parameter against the approved
-- source workbook (AGRO SAFETY POINTS.xlsx). Quality was compared the same
-- way against the 3 approved lab-report PDFs and came back with ZERO
-- discrepancies across all 83 rows (RB 19 / PK 32 / COPRA 32) — nothing to
-- fix there. Every change below is anchored to a specific, quoted row in the
-- approved source; none of them touch a parameter whose source value is
-- itself ambiguous (those are listed, not changed, at the bottom of this
-- file's header comment for your decision).
--
-- Nothing here deletes or renumbers anything. No historical parameter_entries
-- row is touched — corrected rows keep their existing id and continue to
-- FK-link every past reading exactly as before.
--
-- 1) id=544 (VESION BOILER) and id=571 (CVL BOILER) "BLOW DOWN TDS CHECK":
--    input_type is 'number', but target_text was the word "CONDITION" — not
--    a parseable numeric bound. Because no warning/critical numeric columns
--    are set either, this meant NO possible TDS reading, however far out of
--    range, could ever be flagged as a deviation for either boiler — a
--    silent, always-"normal" safety gap. The approved source (AGRO SAFETY
--    POINTS.xlsx, VESION BOILER row 15 / CVL BOILER row 15) states the
--    target explicitly: "< 4000". Restoring that text re-enables real
--    deviation detection via the existing numeric target parser.
--
-- 2) id=306 "FINEL OIL COOLER OUTLET °C" (D) EXTRACTOR): target_text was the
--    bare number "50", which the target parser treats as an exact-match
--    requirement — so a perfectly normal reading of 52°C or 54°C would have
--    been flagged as a deviation. The source (row 27) gives the true
--    two-sided range: "50-55". This removes a source of false alarms rather
--    than adding stricter detection.
--
-- 3) id=586 "STEAM TEMPRETURE CHECK °C" (CVL BOILER): target_text was "100",
--    an 80-degree gap from the source's explicit "180" (row 2). The sibling
--    VESION BOILER row (id=559) for the identical check already correctly
--    reads "180" — id=586 was the one that had drifted. Corrected to match
--    both the source and its own sibling parameter.
--
-- 4) ids 441-444 "PELLETIZER NO 1/2/3/4 RUNNING AMSMSMS" (F) PREPARATORY):
--    the name carries a duplicated-suffix corruption ("AMSMSMS" instead of
--    "AMS", and "PELLETIZER" instead of the source's "PELLETAIZER"). The
--    source (rows 220-223) reads "PELLETAIZER NO n RUNNING AMS" exactly. A
--    stale, uncorrupted duplicate of these same 4 checkpoints existed under
--    a legacy, differently-spelled section ("Preparatory" instead of "F)
--    PREPARATORY") and confirmed the correct wording independently before
--    this fix was made — that legacy section is left untouched here (it has
--    no other issues) since sql/018 already deactivates any parameter
--    section left with zero active rows, and correcting these names does
--    not change that section's row count.
--    The approved TARGET ("80 AMS") was already correct on all 4 rows —
--    only the corrupted parameter NAME text is corrected here.
--
-- Found but NOT changed — source itself is ambiguous or a business-judgement
-- call, left for a Super Admin to confirm and correct in Admin -> Parameters
-- if the drift is unintended:
--  - id=309 "II-nd FLASHER TEMPERATURE °C" (D) EXTRACTOR): source reads
--    "105", DB reads "100". A 5-degree gap that could be a deliberate
--    operating margin rather than a transcription error.
--  - THERMIC FLUID BOILER "SETTING POINT CHECK": source cell itself reads
--    the ambiguous "> 272-280" (mixes a "greater than" symbol with what
--    looks like a two-sided range); DB reads "> 270°C". Not corrected
--    because the source text cannot be confidently parsed to a single
--    intended value.
--  - THERMIC FLUID BOILER "REFINARY TOP THERMIC FLUID OIL EXPANSION TANK
--    LEVEL CHECK": source reads "65-75" (%), DB reads "1/3" — plausibly a
--    sight-glass marking convention specific to this tank rather than a
--    percentage; left for a Super Admin with equipment knowledge to confirm.

update public.parameter_master set target_text='< 4000' where id in (544,571);
update public.parameter_master set target_text='50-55' where id=306;
update public.parameter_master set target_text='180' where id=586;
update public.parameter_master set name='PELLETAIZER NO 1 RUNNING AMS' where id=444;
update public.parameter_master set name='PELLETAIZER NO 2 RUNNING AMS' where id=443;
update public.parameter_master set name='PELLETAIZER NO 3 RUNNING AMS' where id=442;
update public.parameter_master set name='PELLETAIZER NO 4 RUNNING AMS' where id=441;

-- Guard: fail loudly if any of these specific rows moved or vanished since
-- this file was written, rather than silently updating the wrong thing.
do $$
declare bad_count int;
begin
  select count(*) into bad_count from public.parameter_master
  where id in (544,571,306,586,441,442,443,444) and active=false;
  if bad_count>0 then raise exception 'One or more target parameter_master rows are inactive; re-check ids before re-running this migration'; end if;
end $$;
