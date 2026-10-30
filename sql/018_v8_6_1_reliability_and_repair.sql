-- SVMA V8.6.1 — Repair + reliability hardening.
-- Run this AFTER 001-017 (in numeric order) on any environment where the
-- probe below shows gaps. Everything here is additive/idempotent and safe
-- to re-run. Two independent problems are fixed:
--
-- 1) REPAIR: sql/010_v3_operational_intelligence.sql was never applied on
--    some environments (confirmed by direct query: parameter_entries.locked,
--    entry_amendments, quality_sample_tasks and parameter_master.
--    sample_grace_minutes did not exist). Every save then failed with
--    "Could not find the 'locked' column ... in the schema cache", surfaced
--    to operators as the generic "Unable to save entry". Section A restates
--    010 verbatim so any environment reaches the same schema regardless of
--    which files were actually run before.
--
-- 2) RELIABILITY: sql/017_v8_6_complete_safety.sql added an AFTER INSERT
--    trigger (svma_saved_reading_alert) that creates the deviation/ticket/
--    notifications for a bad reading in the SAME transaction as the save —
--    good for atomicity, but as originally written it had no exception
--    handling. In Postgres, an uncaught exception in an AFTER trigger rolls
--    back the entire triggering statement — so a bug in ticket/notification
--    creation (a bad role cast, an RLS surprise, a null join) would silently
--    roll back the READING itself. That is the exact failure mode called
--    out in the brief: "a deviation is a reason to notify, never a reason to
--    reject the save." Section B replaces the trigger with one that can
--    never fail the save, and files any follow-up failure into a durable,
--    retryable, staff-visible queue instead of losing it.
-- ---------------------------------------------------------------------

-- =======================================================================
-- SECTION A — restate 010_v3_operational_intelligence.sql (verbatim, safe to
-- re-run even if 010 already applied cleanly).
-- =======================================================================
do $$ begin
  alter type public.entry_status add value if not exists 'target_missing';
exception when duplicate_object then null; end $$;

alter table public.parameter_entries
  add column if not exists locked boolean not null default true,
  add column if not exists amendment_id uuid,
  add column if not exists amended_value_numeric numeric,
  add column if not exists amended_value_text text,
  add column if not exists amended_at timestamptz,
  add column if not exists amended_by uuid references public.profiles(id);

create table if not exists public.entry_amendments(
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.parameter_entries(id) on delete cascade,
  original_value_numeric numeric,
  original_value_text text,
  corrected_value_numeric numeric,
  corrected_value_text text,
  reason text not null,
  requested_by uuid references public.profiles(id),
  approved_by uuid references public.profiles(id),
  status text not null default 'approved',
  requested_at timestamptz not null default now(),
  approved_at timestamptz
);
create index if not exists idx_amendments_entry on public.entry_amendments(entry_id, requested_at desc);

do $$ begin
  alter table public.parameter_entries
    add constraint entry_amendment_fk foreign key (amendment_id) references public.entry_amendments(id);
exception when duplicate_object then null; end $$;

create or replace function public.enforce_entry_immutability() returns trigger
language plpgsql as $$
begin
  if old.locked and (
    new.value_numeric is distinct from old.value_numeric or
    new.value_text is distinct from old.value_text or
    new.expected_target is distinct from old.expected_target or
    new.status is distinct from old.status or
    new.validation_status is distinct from old.validation_status or
    new.parameter_id is distinct from old.parameter_id or
    new.shift_session_id is distinct from old.shift_session_id or
    new.slot_start is distinct from old.slot_start or
    new.product_code is distinct from old.product_code or
    new.entered_by is distinct from old.entered_by or
    new.server_timestamp is distinct from old.server_timestamp
  ) then
    raise exception 'ENTRY_LOCKED: submitted parameter entries are immutable; use the amendment workflow' using errcode='23514';
  end if;
  return new;
end $$;
drop trigger if exists trg_entry_immutability on public.parameter_entries;
create trigger trg_entry_immutability before update on public.parameter_entries
  for each row execute procedure public.enforce_entry_immutability();

alter table public.notifications
  add column if not exists acknowledged_at timestamptz,
  add column if not exists acknowledged_by uuid references public.profiles(id),
  add column if not exists dedupe_key text;
create unique index if not exists notifications_dedupe_uq on public.notifications(dedupe_key) where dedupe_key is not null;

alter table public.notification_preferences
  add column if not exists sound_enabled boolean not null default true;

drop policy if exists notifications_self_update on public.notifications;
create policy notifications_self_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.parameter_master
  add column if not exists ticket_severity_threshold text not null default 'warning',
  add column if not exists sample_grace_minutes int not null default 15;
do $$ begin
  alter table public.parameter_master
    add constraint parameter_master_ticket_threshold_chk
    check (ticket_severity_threshold in ('warning','critical','none'));
exception when duplicate_object then null; end $$;

create table if not exists public.quality_sample_tasks(
  id uuid primary key default gen_random_uuid(),
  shift_session_id uuid not null references public.shift_sessions(id) on delete cascade,
  parameter_id bigint not null references public.parameter_master(id),
  product_code text not null,
  slot_index int not null default 0,
  sample_due_at timestamptz not null,
  sample_received_at timestamptz,
  result_due_at timestamptz,
  result_submitted_at timestamptz,
  entry_id uuid references public.parameter_entries(id),
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  unique(shift_session_id, parameter_id, product_code, slot_index)
);
create index if not exists idx_sample_tasks_shift on public.quality_sample_tasks(shift_session_id);
create index if not exists idx_sample_tasks_status on public.quality_sample_tasks(status, sample_due_at);
do $$ begin
  alter table public.quality_sample_tasks
    add constraint quality_sample_tasks_status_chk
    check (status in ('pending','sample_received','result_submitted','sample_overdue','result_overdue'));
exception when duplicate_object then null; end $$;

alter table public.quality_sample_tasks enable row level security;
drop policy if exists sample_tasks_read on public.quality_sample_tasks;
create policy sample_tasks_read on public.quality_sample_tasks for select to authenticated using(
  public.is_management() or public.has_role('quality_head') or public.has_role('solvent_head') or
  exists(select 1 from public.shift_sessions s where s.id=shift_session_id and s.operator_id=auth.uid())
);

alter table public.entry_amendments enable row level security;
drop policy if exists amendments_read on public.entry_amendments;
create policy amendments_read on public.entry_amendments for select to authenticated using(
  public.is_management() or public.has_role('solvent_head') or public.has_role('quality_head') or requested_by=auth.uid()
);

create index if not exists idx_entries_operational on public.parameter_entries(shift_session_id, product_code, validation_status);
create index if not exists idx_deviations_severity on public.deviations(severity, status, created_at desc);
create index if not exists idx_notifications_recipient on public.notifications(user_id, read_at, created_at desc);
create index if not exists idx_tickets_severity_status on public.deviation_tickets(status, created_at desc);

-- =======================================================================
-- SECTION B — deviation/ticket/notification processing can never roll back
-- the reading, and a follow-up failure is durable, retryable and visible.
-- =======================================================================

create table if not exists public.deviation_processing_failures(
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.parameter_entries(id) on delete cascade,
  shift_session_id uuid references public.shift_sessions(id),
  parameter_id bigint references public.parameter_master(id),
  validation_status text not null,
  error_detail text,
  status text not null default 'pending',
  attempts int not null default 0,
  last_attempt_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique(entry_id)
);
do $$ begin
  alter table public.deviation_processing_failures
    add constraint deviation_processing_failures_status_chk
    check (status in ('pending','retrying','resolved','failed_permanent'));
exception when duplicate_object then null; end $$;
create index if not exists idx_dev_proc_failures_status on public.deviation_processing_failures(status, created_at desc);
alter table public.deviation_processing_failures enable row level security;
drop policy if exists dev_proc_failures_read on public.deviation_processing_failures;
create policy dev_proc_failures_read on public.deviation_processing_failures for select to authenticated using(
  public.is_management() or public.has_role('solvent_head') or public.has_role('quality_head')
);

-- Shared, idempotent core: create the deviation + (gated) ticket + (gated)
-- notifications for one already-saved entry. Safe to call more than once
-- for the same entry_id — every insert either targets a unique key or
-- checks for an existing row first, so retries can never duplicate a
-- ticket or re-alert a recipient who has already been notified.
create or replace function public.svma_process_deviation_entry(p_entry_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  ent record; p record; scope_name text; v_deviation_id uuid; fact text; ticket_worthy boolean;
begin
  select * into ent from public.parameter_entries where id=p_entry_id;
  if not found or ent.validation_status not in ('warning','critical') then return; end if;
  select pm.*,s.module,s.name section_name into p from public.parameter_master pm join public.parameter_sections s on s.id=pm.section_id where pm.id=ent.parameter_id;
  if not found or p.module not in ('solvent','boiler','quality') then return; end if;
  scope_name:=case when p.module='quality' then 'quality' else 'solvent' end;
  fact:=p.section_name||' · '||p.name||': actual '||coalesce(ent.value_numeric::text,ent.value_text,'')||'; target '||coalesce(ent.expected_target,'');

  select d.id into v_deviation_id from public.deviations d where d.entry_id=ent.id;
  if v_deviation_id is null then
    insert into public.deviations(entry_id,shift_session_id,parameter_id,severity,target_text,actual_text,status,observed_facts)
    values(ent.id,ent.shift_session_id,ent.parameter_id,ent.validation_status,ent.expected_target,coalesce(ent.value_numeric::text,ent.value_text,''),'open',jsonb_build_array(fact))
    returning id into v_deviation_id;
  end if;

  -- Per-parameter admin control (Sections M/AL): 'none' never tickets,
  -- 'critical' tickets only a critical reading, otherwise (default
  -- 'warning') every deviation tickets — restores the configurable
  -- threshold the UI already exposes but neither the app layer nor the
  -- original trigger actually honoured.
  ticket_worthy:=coalesce(p.ticket_enabled,true) and (
    coalesce(p.ticket_severity_threshold,'warning')='warning'
    or (p.ticket_severity_threshold='critical' and ent.validation_status='critical')
  );
  if ticket_worthy and not exists(select 1 from public.deviation_tickets t where t.deviation_id=v_deviation_id) then
    insert into public.deviation_tickets(ticket_no,deviation_id,status,due_at)
    values('SVMA-'||case when scope_name='quality' then 'QC-' else 'SOL-' end||to_char(now(),'YYYYMMDD')||'-'||replace(ent.id::text,'-',''),v_deviation_id,'open',now()+interval '2 hours');
  end if;

  if coalesce(p.alert_enabled,true) then
    insert into public.notifications(user_id,event_type,title,body,severity,entity_type,entity_id,dedupe_key)
    select recipients.user_id,scope_name||'_parameter_deviation',upper(ent.validation_status)||' • '||p.name,fact,ent.validation_status,'deviation',v_deviation_id::text,'deviation:'||ent.id::text||':'||recipients.user_id::text
    from (select ent.entered_by user_id union select ur.user_id from public.user_roles ur where ur.role::text in ('super_admin','admin','management','ceo','solvent_head') or (scope_name='quality' and ur.role::text='quality_head')) recipients
    where recipients.user_id is not null on conflict(dedupe_key) do nothing;
  end if;
end $$;
revoke all on function public.svma_process_deviation_entry(uuid) from public;

-- The trigger itself: always returns new, so a failure anywhere inside
-- svma_process_deviation_entry can NEVER roll back the reading that fired
-- it. A failure is instead filed as a durable, retryable record so
-- authorised staff can see it and it can be retried automatically.
create or replace function public.svma_saved_reading_alert() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  begin
    perform public.svma_process_deviation_entry(new.id);
  exception when others then
    insert into public.deviation_processing_failures(entry_id,shift_session_id,parameter_id,validation_status,error_detail,status,attempts,last_attempt_at)
    values(new.id,new.shift_session_id,new.parameter_id,new.validation_status,sqlerrm,'pending',1,now())
    on conflict(entry_id) do update set error_detail=excluded.error_detail,attempts=public.deviation_processing_failures.attempts+1,last_attempt_at=now(),status='pending';
  end;
  return new;
end $$;
revoke all on function public.svma_saved_reading_alert() from public;
drop trigger if exists svma_saved_reading_alert on public.parameter_entries;
create trigger svma_saved_reading_alert after insert on public.parameter_entries for each row execute function public.svma_saved_reading_alert();

-- Retry sweep: re-attempts every pending/retrying failure (up to 5 tries),
-- called from a staff-visible endpoint (see app/api/deviations/process-pending)
-- on a client poll, mirroring the existing Quality SLA sweep pattern so
-- pending processing recovers automatically once the app is reopened after
-- an interruption, without needing a separate background worker.
create or replace function public.svma_retry_pending_deviation_processing() returns int
language plpgsql security definer set search_path=public,pg_temp as $$
declare r record; resolved_count int:=0;
begin
  for r in select * from public.deviation_processing_failures where status in ('pending','retrying') and attempts<5 order by created_at loop
    begin
      perform public.svma_process_deviation_entry(r.entry_id);
      update public.deviation_processing_failures set status='resolved',resolved_at=now() where id=r.id;
      resolved_count:=resolved_count+1;
    exception when others then
      update public.deviation_processing_failures
        set attempts=attempts+1,last_attempt_at=now(),error_detail=sqlerrm,
            status=case when attempts+1>=5 then 'failed_permanent' else 'retrying' end
        where id=r.id;
    end;
  end loop;
  return resolved_count;
end $$;
revoke all on function public.svma_retry_pending_deviation_processing() from public;

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- =======================================================================
-- SECTION C — Cooling Pond section-assignment repair (Phase 4 audit).
-- Row-by-row comparison against AGRO SAFETY POINTS.xlsx ("1ST SHIFT" sheet,
-- rows 49-93, the 45-row "C) COOLING POND" checklist) found the source
-- coverage is complete (all 45 rows are already saved and active) plus one
-- legitimate pre-existing parameter ("SAFETY BOILER TEMPERATUE °C") kept
-- per the "preserve additional original parameters" rule — so nothing is
-- missing or duplicated in terms of DATA. But two of the 45 required rows
-- ("COOLING TOWER PUMP -1/-2 GLAND ROPE CHECK") are filed under a stale,
-- differently-named parameter_sections row ("Cooling Pond", pre-dating the
-- "C) COOLING POND" naming convention) instead of the current one. Because
-- both section rows are `active`, this made an extra "Cooling Pond" category
-- tab appear in the Solvent entry workspace next to the real one. This
-- section moves those two parameter rows to the correct, current section —
-- no target, history, or reading is touched, only which section a still-
-- active checklist row displays under — and then hides (never deletes) any
-- parameter_sections row left with zero active parameters, so a legacy
-- section can never again render as a confusing near-empty duplicate tab.
-- =======================================================================
do $$
declare canonical_id bigint; legacy_id bigint;
begin
  select id into canonical_id from public.parameter_sections where module='solvent' and name='C) COOLING POND';
  select id into legacy_id from public.parameter_sections where module='solvent' and name='Cooling Pond';
  if canonical_id is not null and legacy_id is not null then
    update public.parameter_master
      set section_id=canonical_id
      where section_id=legacy_id and active
        and upper(regexp_replace(name,'[^A-Za-z0-9]','','g')) in (
          upper(regexp_replace('COOLING TOWER PUMP -1 GLAND ROPE CHECK  - LOAD AMS PUMP -1 CHECK','[^A-Za-z0-9]','','g')),
          upper(regexp_replace('COOLING TOWER PUMP -2 GLAND ROPE CHECK  LOAD AMS PUMP -2 CHECK','[^A-Za-z0-9]','','g'))
        );
  end if;
end $$;

update public.parameter_sections s set active=false
where module in ('solvent','boiler')
  and not exists(select 1 from public.parameter_master p where p.section_id=s.id and p.active);
