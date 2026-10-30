-- Adds back "E) LAB ANALYSING REPORT" as a live section of the Solvent plant
-- checklist (sql/052 deliberately left it out — neither of the two existing
-- same-named sections, module='solvent' id 5 and module='quality' id 32, is
-- active; Quality's real lab system is a different, richer per-product
-- structure at module='quality' id 42 "PROCESS LAB REPORT"). The user asked
-- for these 6 rows added as their own new section rather than folded into
-- either of those, so this creates a fresh active section instead of
-- reactivating either deprecated one.
begin;
lock table public.parameter_master in share row exclusive mode;

-- (sort_order 45 sits between D) EXTRACTOR (1ST FLOOR) at 40 and
-- E) SECOND FLOOR at 50, matching this section's position in the sheet.)
with new_section as (
  insert into public.parameter_sections(module, name, sort_order, active)
  values ('solvent', 'E) LAB ANALYSING REPORT', 45, true)
  returning id
)
insert into public.parameter_master(section_id, source_ref, source_text, name, target_text, input_type, frequency, deviation_severity, options, mandatory, active, ticket_enabled, ticket_severity_threshold)
select ns.id, v.source_ref, v.name, v.name, v.target_text, v.input_type, 'hourly', 'critical', v.options::jsonb, true, true, true, 'warning'
from new_section ns,
(values
  ('AGRO_V9:R169', 'SOLVENT PRODUCTION OIL FLASH', '110°C - 120°C', 'number', '[]'),
  ('AGRO_V9:R170', 'SOLVENT PRODUCTION OIL MOISTURE %', '10-25', 'number', '[]'),
  ('AGRO_V9:R171', 'SOLVENT PRODUCTION MISCELLA SAMPLE %', '15-18', 'number', '[]'),
  ('AGRO_V9:R172', 'SOLVENT PRODUCTION OIL COLOR', 'RED & YELLOW', 'select', '["RED","YELLOW","OTHER"]'),
  ('AGRO_V9:R174', 'GODOWN DORB MOISTURE %', '6-12', 'number', '[]'),
  ('AGRO_V9:R175', 'SIEVED NICE FIBER %', '> 16', 'number', '[]')
) as v(source_ref, name, target_text, input_type, options);

commit;
