-- Solvent / Boiler corrections from "SAFETY - AI.pdf" (AGRO SAFETY - AI, 17.10.2026) — items 10 to 20.
-- Items 1-9 of the same sheet are in sql/067_solvent_target_corrections.sql: RUN 067 FIRST.
-- Nothing is deleted. Every past entry, deviation and ticket stays; switched-off items keep their history in reports.
-- Only these parameters are touched (the other solvent parameters whose alarm band differs from their target text
-- were deliberately left alone). Safe to re-run.
--
-- Why the alarm bands change as well as the text: when a parameter has warning/critical limits, the system judges
-- readings against those limits and ignores the target text, so fixing only the text would not stop false alarms.
--
--  #10 II-nd Flasher Temperature (id 309)        text 100 - 110 is right; the band was 100-105 -> 100-110
--  #11 1st Flasher Steam Temperature (id 312)    text 85 - 100 is right; the band was 85-90 (a reading of 100 was critical) -> 85-100
--  #12 Extractor Monometer Vacuum (id 323)       "-1MM TO 3MM" (missing minus) -> -1 TO -3, band -1..3 -> -3..-1
--  #13 Final Vent pressure (id 319)              switched off
--  #14 12th Spray oil % (id 291)                 switched off
--  #15-19 20 / 20A / 19 / 19A / 23 Condensor temperature checks (ids 296, 295, 294, 293, 292)  switched off
--  #20 DT Output Sample Temperature (id 225)     "> 95°C-110°C" -> 95 - 110, band 95-105 -> 95-110

do $$
declare n_upd int; n_band int; n_off int;
begin
  -- target text + band
  with src(id, section_name, name, target_text, wlow, whigh) as (values
  (323, 'D) EXTRACTOR (1ST FLOOR)',        'EXTRACTOR MONOMETER VACCUM CHECK',      '-1 TO -3', -3::numeric, -1::numeric),
  (225, 'B) DESOLVENDIZER TOSTER (DT)',    'DT OUT PUT SAMPLE TEMPERATURE CHECK',   '95 - 110',  95::numeric, 110::numeric)
  )
  update public.parameter_master pm
  set target_text = src.target_text, warning_low = src.wlow, warning_high = src.whigh
  from src, public.parameter_sections ps
  where pm.id = src.id and pm.name = src.name and ps.id = pm.section_id and ps.name = src.section_name and pm.active;
  get diagnostics n_upd = row_count;
  if n_upd <> 2 then raise exception 'Expected to update 2 parameters (text + band) but updated % — a parameter was renamed or switched off. Nothing should be relied on until this is checked.', n_upd; end if;

  -- band only (the target text is already right)
  with src(id, section_name, name, target_text, wlow, whigh) as (values
  (309, 'D) EXTRACTOR (1ST FLOOR)', 'II-nd FLASHER TEMPERATURE °C',        '100 - 110', 100::numeric, 110::numeric),
  (312, 'D) EXTRACTOR (1ST FLOOR)', '1ST FLASHER STEAM TEMPERATURE °C',    '85 - 100',   85::numeric, 100::numeric)
  )
  update public.parameter_master pm
  set warning_low = src.wlow, warning_high = src.whigh
  from src, public.parameter_sections ps
  where pm.id = src.id and pm.name = src.name and pm.target_text = src.target_text and ps.id = pm.section_id and ps.name = src.section_name and pm.active;
  get diagnostics n_band = row_count;
  if n_band <> 2 then raise exception 'Expected to update the band of 2 parameters but updated % — a name or target text changed. Nothing should be relied on until this is checked.', n_band; end if;

  -- switched off (history kept)
  with src(id, name) as (values
  (319, 'FINEL VENT PRESSURE MAINTAIN'),
  (291, 'EXTRACTER 12th SPRAY OIL %'),
  (296, '20 CONDENSOR TEMPERATURE CHECK °C'),
  (295, '20A CONDENSOR TEMPERATURE CHECK °C'),
  (294, '19 CONDENSOR TEMPERATURE CHECK °C'),
  (293, '19A CONDENSOR TEMPERATURE CHECK °C'),
  (292, '23 CONDENSOR TEMPERATURE CHECK °C')
  )
  update public.parameter_master pm set active = false
  from src
  where pm.id = src.id and pm.name = src.name;
  get diagnostics n_off = row_count;
  if n_off <> 7 then raise exception 'Expected to switch off 7 parameters but matched % — a name changed. Nothing should be relied on until this is checked.', n_off; end if;
end $$;
