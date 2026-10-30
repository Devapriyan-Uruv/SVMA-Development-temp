-- Solvent / Boiler target corrections from the handwritten "A.I. CORRECTION" sheet.
-- Only the target text changes (and one duplicate check is switched off). Frequencies, units, limits,
-- severities and every past entry, deviation and ticket stay exactly as they are. Safe to re-run.
--
--  1. VESION BOILER Blow Down TDS         "< 1500-4000"  -> 1500-4000     (CVL BOILER already correct)
--  2. Cooling Tower Fans No 1 / 2 / 3     "80-10"        -> 8-10
--  3. Safety Boiler Temperature           ">90"          -> 85-90
--  4. Cooling Pond Water TDS              "< 200-600"    -> 200-600
--  5. Duplicate "COOLING BOND WATER TDS < 500 PPM" (Extractor 1st Floor, id 301) -> switched off.
--     The same reading is already taken as "COOLING POND WATER TDS/PPM" in the Cooling Pond section.
--     Switched off, not deleted, so its 198 past entries stay in reports.
--  6. Vacuum Pump Load                    "15-20 AMS"    -> 15-25 AMS
--  7. Pond Incoming Water Header Pressure "1- '1.2"      -> 1-1.2   (the stray apostrophe made the
--     system read it as exactly 1, so almost every reading was raised as critical)

do $$
declare n_upd int; n_exp int := 8; n_off int;
begin
  with src(id, section_name, name, target_text) as (values
  (279, 'C) COOLING POND', 'COOLING TOWER FAN NO 3 AMS CHECK', '8-10'),  -- was '80-10'
  (280, 'C) COOLING POND', 'COOLING TOWER FAN NO 2 AMS CHECK', '8-10'),  -- was '80-10'
  (281, 'C) COOLING POND', 'COOLING TOWER FAN NO 1 LOAD AMS CHECK', '8-10'),  -- was '80-10'
  (282, 'C) COOLING POND', 'SAFETY BOILER TEMPERATUE °C', '85-90'),  -- was '>90'
  (396, 'E) SECOND FLOOR', 'POND INCOMMING WATER HEADER PRESSURE KG', '1-1.2'),  -- was '1- ''1.2'
  (397, 'E) SECOND FLOOR', 'VACUUM PUMP LOAD', '15-25 AMS'),  -- was '15-20 AMS'
  (544, 'VESION BOILER', 'BLOW DOWN TDS CHECK', '1500-4000'),  -- was '< 1500-4000'
  (781, 'C) COOLING POND', 'COOLING POND WATER TDS/PPM', '200-600')  -- was '< 200-600'
  )
  update public.parameter_master pm
  set target_text = src.target_text
  from src, public.parameter_sections ps
  where pm.id = src.id and pm.name = src.name and ps.id = pm.section_id and ps.name = src.section_name and pm.active;
  get diagnostics n_upd = row_count;
  if n_upd <> n_exp then
    raise exception 'Expected to update % parameters but updated % — a parameter was renamed or switched off since this script was written. Nothing should be relied on until this is checked.', n_exp, n_upd;
  end if;

  update public.parameter_master set active = false
  where id = 301 and name = 'COOLING BOND WATER TDS';
  get diagnostics n_off = row_count;
  if n_off > 1 then raise exception 'Switched off more than one parameter — check id 301.'; end if;
end $$;
