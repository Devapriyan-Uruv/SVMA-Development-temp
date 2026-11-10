-- Stage 1: archive the two retired Solvent parameter definitions.
-- SAFE: this migration does not delete from parameter_master and does not
-- drop or alter any foreign keys. Run this before deploying code that reads
-- parameter_master_archive. Review the two source rows before proceeding.

begin;

create table if not exists public.parameter_master_archive
  (like public.parameter_master including all);
alter table public.parameter_master_archive
  add column if not exists archived_at timestamptz not null default now(),
  add column if not exists archive_reason text,
  add column if not exists archived_section_name text,
  add column if not exists archived_section_module text,
  add column if not exists archived_section_sort_order integer;

comment on table public.parameter_master_archive is
  'Full historical copies of retired parameter_master rows. Referenced by historical parameter_id values after retirement.';

-- Guard against archiving an unexpected row under either ID.
do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.parameter_master
  where id in (302,303)
    and (
      (id = 302 and name = 'COOLING BOND WATER PH' and section_id = 31)
      or
      (id = 303 and name = 'COOLING BOND WATER TH' and section_id = 31)
    );

  if v_count <> 2 then
    raise exception 'Expected exactly the two known Solvent parameters (302/303, section 31); found % matching rows. No archive was written.', v_count;
  end if;
end $$;

-- LIKE INCLUDING ALL preserves the current parameter_master column layout.
-- Explicit column list is generated from the live table to remain resilient
-- to columns added by later migrations.
do $$
declare
  cols text;
begin
  select string_agg(format('%I', column_name), ', ' order by ordinal_position)
    into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'parameter_master';

  execute format(
    'insert into public.parameter_master_archive (%s, archived_at, archive_reason) '
    'select %s, now(), %L from public.parameter_master where id in (302,303) '
    'on conflict (id) do nothing',
    cols, cols, 'Retired from active Solvent parameter list by approved parameter retirement'
  );
end $$;


update public.parameter_master_archive a
set
  archived_section_name = s.name,
  archived_section_module = s.module,
  archived_section_sort_order = s.sort_order
from public.parameter_sections s
where a.section_id = s.id
  and a.id in (302, 303);
-- Verify both archived rows and their identifying metadata.
do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.parameter_master_archive
  where id in (302,303)
    and (
      (id = 302 and name = 'COOLING BOND WATER PH' and section_id = 31)
      or
      (id = 303 and name = 'COOLING BOND WATER TH' and section_id = 31)
    );

  if v_count <> 2 then
    raise exception 'Archive verification failed: expected 2 archived rows, found %.', v_count;
  end if;
end $$;

commit;

-- Post-run verification:
-- select id, name, section_id, target_text, frequency, mandatory, active, archived_at
-- from public.parameter_master_archive where id in (302,303) order by id;
-- select count(*) from public.parameter_master where id in (302,303); -- should still be 2 at Stage 1
