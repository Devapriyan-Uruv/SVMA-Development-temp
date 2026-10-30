-- SVMA AI Intelligence Platform V3 — Operational Intelligence
-- Adds: server-side entry immutability + amendment workflow, TARGET_MISSING
-- as a first-class status, Quality sample/result SLA tracking, notification
-- acknowledgement + de-duplication, and a per-parameter ticket severity
-- threshold. Additive only — every statement is safe to re-run and nothing
-- here touches Finance/reconciliation tables or logic.
-- Run ONCE after V2.4 (009). Safe to re-run.

-- ---------------------------------------------------------------------
-- A) TARGET_MISSING becomes a real, distinct status (Section G)
-- ---------------------------------------------------------------------
do $$ begin
  alter type public.entry_status add value if not exists 'target_missing';
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- B) Entry immutability + amendment overlay (Section C)
-- ---------------------------------------------------------------------
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

alter table public.parameter_entries
  add constraint entry_amendment_fk foreign key (amendment_id) references public.entry_amendments(id);

-- Server-side lock: once an entry row exists, its captured facts cannot be
-- overwritten by a normal UPDATE. Only the designated amendment overlay
-- columns (amended_*), plus late-arriving deviation/ticket linkage fields
-- that the deterministic pipeline itself sets once, may ever change. This
-- is enforced in the database itself — not just hidden by the UI — so even
-- a direct API/service-role call cannot silently rewrite a captured fact.
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

-- ---------------------------------------------------------------------
-- C) Notifications: acknowledgement + idempotent de-duplication (Section L)
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- D) Configurable ticket severity threshold (Sections M, AL)
-- ---------------------------------------------------------------------
alter table public.parameter_master
  add column if not exists ticket_severity_threshold text not null default 'warning',
  add column if not exists sample_grace_minutes int not null default 15;
do $$ begin
  alter table public.parameter_master
    add constraint parameter_master_ticket_threshold_chk
    check (ticket_severity_threshold in ('warning','critical','none'));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- E) Quality sample / result SLA tracking (Sections T, U, V, W, X, Y)
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- F) Index hygiene called for by the spec (Section AG)
-- ---------------------------------------------------------------------
create index if not exists idx_entries_operational on public.parameter_entries(shift_session_id, product_code, validation_status);
create index if not exists idx_deviations_severity on public.deviations(severity, status, created_at desc);
create index if not exists idx_notifications_recipient on public.notifications(user_id, read_at, created_at desc);
create index if not exists idx_tickets_severity_status on public.deviation_tickets(status, created_at desc);
