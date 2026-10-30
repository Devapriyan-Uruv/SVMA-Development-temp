-- QC Data Entry: new process-lab targets and items from "LAB REPORTS -AI.xlsx"
-- Applies the sheets "RB" (Rice Bran), "PK-03-10-26" (Palm Kernel) and "E&NE-03-10-26" (Copra).
-- NOT applied: the "RICE BRAN" tab, the "03-10-26-RB" tab and "NOTES".
--
-- Entry itself is unchanged: same groups, same frequencies/result times, same
-- input types. Only targets change, plus three RB items added and two retired.
-- Existing parameter rows are updated IN PLACE (same id), so every submitted
-- entry and deviation keeps pointing at the same parameter. Nothing is deleted.
-- Safe to re-run.
--
-- Target wording follows lib/targetParser.ts: "a - b" = range, "< n" = upper limit (every
-- "max" on the lab sheets is written this way), "NIL" = categorical.
--
-- Applied exactly as written in the new file, including values that look
-- unusual (PK FFA < 5, Copra DT oil 3 - 7, PK protein < 15, RB colour
-- < 40) — confirmed as intended.
-- Left at the CURRENT target on purpose: RB DORB % OIL (id 613, "< 0.40") —
-- the sheet's 0.004 was not accepted.

do $$
declare n_upd int; n_exp int := 69;
begin
  with src(id, product_code, source_group, name, target_text) as (values
  (609, 'RB', 'RICE BRAN (FEEDING)', '% MOISTURE', '9 - 10'),  -- was '8 - 10'
  (717, 'PK', 'PALM KERNAL CAKE', '% FFA', '< 5'),  -- was '5 - 25'
  (684, 'PK', 'PK OIL', '% FFA', '< 5'),  -- was '5 - 25'
  (635, 'COPRA', 'COPRA DT', '% OIL', '3 - 7'),  -- was '< 0.40'
  (677, 'PK', 'PK - CHIPS', '% PROTEIN', '< 15'),  -- was '10 - 12'
  (733, 'PK', 'NICE- 1', '% PROTEIN', '< 15'),  -- was '10 - 12'
  (683, 'PK', 'NICE - 2', '% PROTEIN', '< 15'),  -- was '10 - 12'
  (709, 'RB', 'RB OIL', 'COLOUR (IN 1/4" CELL)', '< 40'),  -- was '> 40 UNITS'
  (610, 'RB', 'RICE BRAN (FEEDING)', '% OIL', '7 - 27'),  -- was '15 - 25'
  (611, 'RB', 'RICE BRAN (FEEDING)', '% FFA', '5 - 30'),  -- was '4 - 30'
  (612, 'RB', 'DORB', '% MOISTURE', '10.5 - 12'),  -- was '10.5 - 12'
  (614, 'RB', 'DORB', '% S&S', '< 5'),  -- was '< 5'
  (615, 'RB', 'DORB', '% FIBER', '10.5 - 14.5'),  -- was '10 - 14'
  (616, 'RB', 'DORB', '% PROTEIN', '14.5 - 16'),  -- was '14.5 - 16'
  (618, 'RB', 'RB OIL', '% FFA', '5 - 30'),  -- was '4 - 30'
  (621, 'RB', 'RB OIL', '% OIL IN MISCELLA', '15 - 18'),  -- was '16 - 18'
  (623, 'RB', 'RB OIL', '% WAX', '< 3'),  -- was '2.5 - 3.5'
  (624, 'RB', 'RB OIL', '% GUM', '< 2.5'),  -- was '1 - 1.5'
  (629, 'COPRA', 'EDIBLE COPRA CAKE', '% MOISTURE', '6 - 8.5'),  -- was '< 7'
  (631, 'COPRA', 'NON-EDIBLE COPRA CAKE', '% FFA', '2 - 20'),  -- was '3 - 15'
  (632, 'COPRA', 'NON-EDIBLE COPRA CAKE', 'SHELL CONTENT', '< 1'),  -- was '< 1'
  (633, 'COPRA', 'NON-EDIBLE COPRA CAKE', 'MILLING DEFECTS', '< 1'),  -- was '< 1'
  (634, 'COPRA', 'COPRA DT', '% MOISTURE', '10.5 - 12'),  -- was '< 10'
  (636, 'COPRA', 'COPRA DT', 'SHELL CONTENT', '< 1'),  -- was '< 1'
  (637, 'COPRA', 'COPRA DT', 'MILLING DEFECTS', '< 1'),  -- was '< 1'
  (638, 'COPRA', 'COPRA DOC - CHIPS', '% MOISTURE', '10 - 12'),  -- was '< 10'
  (640, 'COPRA', 'COPRA DOC - CHIPS', '% S&S', '< 2'),  -- was '< 2'
  (641, 'COPRA', 'COPRA DOC - CHIPS', '% FIBER', '8 - 12'),  -- was '< 12'
  (642, 'COPRA', 'COPRA DOC - CHIPS', '% PROTEIN', '20 - 24'),  -- was '> 23'
  (643, 'COPRA', 'NICE - 1', '% MOISTURE', '4 - 7'),  -- was '< 7'
  (645, 'COPRA', 'NICE - 1', '% S&S', '< 2'),  -- was '< 2'
  (646, 'COPRA', 'NICE - 1', '% FIBER', '6 - 8'),  -- was '< 10'
  (647, 'COPRA', 'NICE - 1', '% PROTEIN', '20 - 24'),  -- was '> 20'
  (648, 'COPRA', 'NICE - 2', '% MOISTURE', '< 6'),  -- was '< 7'
  (650, 'COPRA', 'NICE - 2', '% S&S', '< 2'),  -- was '< 2'
  (651, 'COPRA', 'NICE - 2', '% FIBER', '6 - 8'),  -- was '< 10'
  (652, 'COPRA', 'NICE - 2', '% PROTEIN', '20 - 24'),  -- was '> 20'
  (653, 'COPRA', 'COPRA OIL', '% FFA', '2 - 20'),  -- was '3 - 15'
  (654, 'COPRA', 'COPRA OIL', '% MOISTURE', '< 0.2'),  -- was '< 0.25'
  (655, 'COPRA', 'COPRA OIL', 'IV', '8 - 11'),  -- was '8 - 15'
  (657, 'COPRA', 'COPRA OIL', '% OIL IN MISCELLA', '9 - 12'),  -- was '< 15'
  (658, 'COPRA', 'COPRA OIL', 'SEDIMENTS', '< 0.5'),  -- was '< 0.50'
  (670, 'PK', 'PK DT', '% MOISTURE', '< 5'),  -- was '< 7'
  (672, 'PK', 'PK DT', '% OIL', '< 0.4'),  -- was '< 0.35'
  (673, 'PK', 'PK DT', 'SHELL CONTENT', '< 1'),  -- was '< 1.5'
  (674, 'PK', 'PK DT', 'MILLING DEFECTS', '< 1'),  -- was '< 1'
  (675, 'PK', 'PK - CHIPS', '% S&S', '< 2'),  -- was '< 2'
  (676, 'PK', 'PK - CHIPS', '% FIBER', '< 40'),  -- was '30'
  (681, 'PK', 'NICE - 2', '% S&S', '< 2'),  -- was '2'
  (682, 'PK', 'NICE - 2', '% FIBER', '< 20'),  -- was '< 20'
  (685, 'PK', 'PK OIL', '% MOISTURE', '< 0.5'),  -- was '0.20'
  (688, 'PK', 'PK OIL', '% OIL IN MISCELLA', '7 - 10'),  -- was '12 - 15'
  (695, 'PK', 'NICE - 2', '% MOISTURE', '< 6'),  -- was '6'
  (712, 'RB', 'RECUPERATION HOT OIL', 'HOT OIL MOISTURE', '< 1.5'),  -- was '1.5'
  (713, 'RB', 'RECUPERATION COLD OIL', 'COLD OIL MOISTURE', '< 3.5'),  -- was '2.5'
  (715, 'PK', 'PALM KERNAL CAKE', '% MOISTURE', '5 - 10'),  -- was '5 - 8'
  (716, 'PK', 'PALM KERNAL CAKE', '% OIL', '7 - 14'),  -- was '15'
  (719, 'PK', 'PALM KERNAL CAKE', 'SHELL CONTENT', '< 1'),  -- was '< 1.5'
  (720, 'PK', 'PALM KERNAL CAKE', 'MILLING DEFECTS', '< 1'),  -- was '< 1'
  (730, 'PK', 'NICE- 1', '% MOISTURE', '< 6'),  -- was '6'
  (731, 'PK', 'NICE- 1', '% S&S', '< 2'),  -- was '2'
  (732, 'PK', 'NICE- 1', '% FIBER', '< 20'),  -- was '< 20'
  (740, 'PK', 'PK OIL', 'IV (IODINE VALUE)', '15 - 24'),  -- was '15 - 24'
  (743, 'PK', 'PK OIL', 'SEDIMENTS %', '< 0.25'),  -- was '0.50'
  (744, 'PK', 'RECUPERATION HOT OIL', 'HOT OIL MOISTURE', '1.5 - 3.5'),  -- was '1.5'
  (745, 'PK', 'RECUPERATION OIL COLD', 'COLD OIL MOISTURE', '1.5 - 2.5'),  -- was '2.5'
  (775, 'COPRA', 'COPRA OIL', 'COLOUR (IN 1/2" CELL)', '40 - 75'),  -- was '< 70 UNITS'
  (776, 'COPRA', 'RECUPERATION HOT OIL', 'HOT OIL MOISTURE', '1.5 - 3.5'),  -- was '1.5'
  (777, 'COPRA', 'RECUPERATION COLD OIL', 'COLD OIL MOISTURE', '1 - 2.5')  -- was '2.5'
  )
  update public.parameter_master pm
  set target_text = src.target_text
  from src
  where pm.id = src.id and pm.product_code = src.product_code
    and pm.source_group = src.source_group and pm.name = src.name and pm.active;
  get diagnostics n_upd = row_count;
  if n_upd <> n_exp then
    raise exception 'Expected to update % lab parameters but updated % — a parameter was renamed or deactivated since this script was written. Nothing should be applied until this is checked.', n_exp, n_upd;
  end if;
end $$;

-- Items that are no longer on the lab sheets are switched off, not deleted.
with src(id, product_code, source_group, name) as (values
  (718, 'PK', 'PALM KERNAL CAKE', 'IV'),
  (706, 'RB', 'RB OIL', '% MOISTURE & IMPURITIES')
)
update public.parameter_master pm set active = false
from src
where pm.id = src.id and pm.product_code = src.product_code and pm.source_group = src.source_group and pm.name = src.name;

-- New Rice Bran items: DT moisture, DT O.C (one day only, so optional) and % MIV.
insert into public.parameter_master(
  section_id, source_ref, source_file, source_serial, source_group, source_text,
  product_code, name, unit, target_text, input_type, frequency, sample_frequency,
  result_latency_minutes, mandatory, alert_enabled, ticket_enabled, options,
  sort_order, active, source_review_required
)
select ps.id, 'LAB REPORTS -AI.xlsx (RB)', 'LAB REPORTS -AI.xlsx', v.serial, v.grp,
  'RB / ' || v.grp || ' / ' || v.name, 'RB', v.name, '%', v.target, 'number', v.freq, v.sample_freq,
  v.latency, v.mandatory, true, true, '[]'::jsonb, v.sort_order, true, false
from (values
  ('20', 'DT',     '% MOISTURE', '8 - 10',   'hourly',          'Every Hour',   90, true,  4),
  ('21', 'DT',     '% O.C',      '< 0.4',  'once_per_shift',  'ONCE IN A SHIFT (OC on any one day only)', 90, false, 4),
  ('22', 'RB OIL', '% MIV',      '< 0.50',   'every_4_hours',   'Every 4 Hr.',  90, true,  11)
) as v(serial, grp, name, target, freq, sample_freq, latency, mandatory, sort_order)
join public.parameter_sections ps on ps.module = 'quality' and ps.name = 'PROCESS LAB REPORT'
on conflict (section_id, product_code, source_group, name)
do update set target_text = excluded.target_text, active = true;
