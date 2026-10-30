-- QC Data Entry: updates from the new "LAB REPORTS -AI.xlsx" — sheets "03-10-26-RB" (Rice Bran) and "NON EDIBLE COPRA".
-- Run after sql/063. Existing parameters are updated IN PLACE (same id), so every submitted entry and deviation keeps
-- pointing at the same parameter. Nothing is deleted. Safe to re-run.
--
-- RICE BRAN ("03-10-26-RB")
--   Rice Bran (Feeding) % MOISTURE / % OIL / % FFA   sample every 2 hours -> EVERY HOUR (all three shifts)
--   Rice Bran (Feeding) % OIL                         7 - 27   -> < 27
--   DT % O.C                                          < 0.4    -> 0.2 - 0.4   (still "one day only", frequency unchanged)
--   DORB % OIL (O.C GD)                               < 0.40   -> 0.1 - 0.4
--   DORB % PROTEIN                                    14.5 - 16 -> 14 - 16
--   Recuperation HOT oil moisture                     < 1.5    -> 1 - 2.5
--   Recuperation COLD oil moisture                    < 3.5    -> 1.5 - 3.5
-- COPRA ("NON EDIBLE COPRA")
--   Copra DT % MOISTURE                               10.5 - 12 -> < 5
--   New group "DOC" (4 items): % MOISTURE 10.5 - 12 (hourly), % S&S < 2, % FIBER < 10, % PROTEIN 21 - 25 (once a shift)
-- Left as they are on purpose: Copra FFA (the sheet disagrees with itself between shifts), Copra DT % OIL, the Moisture
-- Difference line, DOC-CHIPS protein 20 - 24.

do $$
declare n int;
begin
  -- targets
  with src(id, product_code, source_group, name, target_text) as (values
  (610, 'RB',    'RICE BRAN (FEEDING)',  '% OIL',        '< 27'),
  (902, 'RB',    'DT',                   '% O.C',        '0.2 - 0.4'),
  (613, 'RB',    'DORB',                 '% OIL',        '0.1 - 0.4'),
  (616, 'RB',    'DORB',                 '% PROTEIN',    '14 - 16'),
  (712, 'RB',    'RECUPERATION HOT OIL', 'HOT OIL MOISTURE',  '1 - 2.5'),
  (713, 'RB',    'RECUPERATION COLD OIL','COLD OIL MOISTURE', '1.5 - 3.5'),
  (634, 'COPRA', 'COPRA DT',             '% MOISTURE',   '< 5')
  )
  update public.parameter_master pm set target_text = src.target_text
  from src
  where pm.id = src.id and pm.product_code = src.product_code and pm.source_group = src.source_group and pm.name = src.name and pm.active;
  get diagnostics n = row_count;
  if n <> 7 then raise exception 'Expected to update 7 targets but updated % — a parameter was renamed or switched off. Nothing should be applied until this is checked.', n; end if;

  -- Rice Bran (Feeding): sampled every hour
  update public.parameter_master set frequency = 'hourly', sample_frequency = 'Every Hour'
  where id in (609, 610, 611) and product_code = 'RB' and source_group = 'RICE BRAN (FEEDING)' and active;
  get diagnostics n = row_count;
  if n <> 3 then raise exception 'Expected to update the frequency of 3 Rice Bran feeding items but updated %.', n; end if;
end $$;

-- New Copra "DOC" group, placed after Copra DT and before DOC - CHIPS (later items move down by 4).
do $$
begin
  if not exists (select 1 from public.parameter_master where product_code = 'COPRA' and source_group = 'DOC') then
    update public.parameter_master set sort_order = sort_order + 4
    where product_code = 'COPRA' and sort_order >= 11;

    insert into public.parameter_master(
      section_id, source_ref, source_file, source_serial, source_group, source_text,
      product_code, name, unit, target_text, input_type, frequency, sample_frequency,
      result_latency_minutes, mandatory, alert_enabled, ticket_enabled, options,
      sort_order, active, source_review_required
    )
    select ps.id, 'LAB REPORTS -AI.xlsx (NON EDIBLE COPRA)', 'LAB REPORTS -AI.xlsx', v.serial, 'DOC',
      'COPRA / DOC / ' || v.name, 'COPRA', v.name, '%', v.target, 'number', v.freq, v.sample_freq,
      v.latency, true, true, true, '[]'::jsonb, v.sort_order, true, false
    from (values
      ('33', '% MOISTURE', '10.5 - 12', 'hourly',         'Every Hour',      90,  11),
      ('34', '% S&S',      '< 2',       'once_per_shift', 'ONCE IN A SHIFT', 330, 12),
      ('35', '% FIBER',    '< 10',      'once_per_shift', 'ONCE IN A SHIFT', 330, 13),
      ('36', '% PROTEIN',  '21 - 25',   'once_per_shift', 'ONCE IN A SHIFT', 330, 14)
    ) as v(serial, name, target, freq, sample_freq, latency, sort_order)
    join public.parameter_sections ps on ps.module = 'quality' and ps.name = 'PROCESS LAB REPORT';
  end if;
end $$;
