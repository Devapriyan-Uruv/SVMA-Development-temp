-- SVMA V5 ONE-SHOT UPGRADE
-- Paste this entire file into the Supabase SQL Editor if your database is already on V4.
-- It contains the full V5 additive migration; no psql \i command is required.

-- SVMA Intelligent Operations V5
-- Additive only. Does not drop RLS, auth, historical entries or reconciliation history.

alter table public.parameter_entries add column if not exists result_state text;
alter table public.parameter_entries add column if not exists na_reason text;
alter table public.parameter_entries add column if not exists na_note text;


-- ---------------------------------------------------------------------
-- DATA ENTRY TARGET INTEGRITY
-- A deviation is only meaningful when the operator can see the target.
-- These three Quality targets are explicitly defined by the supplied lab
-- report/business brief as NIL and were blank in the V4 seed.
-- ---------------------------------------------------------------------
update public.parameter_master pm
set target_text='NIL', source_review_required=false
from public.parameter_sections ps
where pm.section_id=ps.id
  and ps.module='quality'
  and pm.active=true
  and (
    (pm.product_code='PK' and upper(coalesce(pm.source_group,''))='PK DT' and upper(pm.name)='DT FLASH')
    or (pm.product_code='COPRA' and upper(coalesce(pm.source_group,''))='COPRA DT' and upper(pm.name)='DT FLASH')
    or (pm.product_code='RB' and upper(coalesce(pm.source_group,''))='DORB' and upper(pm.name)='DT FLASH TEST')
  );

-- Admin/reporting helper: identify every data-entry parameter that still
-- needs a business-approved target. Target-less rows must never be part of
-- live operational data entry, but they remain visible in Administration for
-- configuration and audit. Do not invent a target.
create or replace view public.data_entry_target_gaps with (security_invoker=true) as
select pm.id, ps.module, pm.product_code, pm.source_group, pm.source_serial,
       pm.name, pm.unit, pm.frequency, pm.target_text, pm.source_ref, pm.active
from public.parameter_master pm
join public.parameter_sections ps on ps.id=pm.section_id
where ps.module in ('quality','solvent','boiler')
  and (pm.target_text is null or btrim(pm.target_text)='');

-- Final target gate: if the supplied source does not contain an approved
-- target, keep the parameter in the master for Administration/audit but make
-- it INACTIVE for operational data entry. Historical entries remain intact.
-- Once Admin configures the approved target, the row can be activated.
update public.parameter_master pm
set active=false, source_review_required=true, alert_enabled=false, ticket_enabled=false
from public.parameter_sections ps
where pm.section_id=ps.id
  and pm.active=true
  and ps.module in ('quality','solvent','boiler')
  and (pm.target_text is null or btrim(pm.target_text)='');

update public.parameter_entries
set result_state=case when upper(coalesce(value_text,''))='NA' then 'na' else 'result' end
where result_state is null;

alter table public.parameter_entries drop constraint if exists parameter_entries_result_state_chk;
alter table public.parameter_entries add constraint parameter_entries_result_state_chk
check (result_state is null or result_state in ('result','na'));

create table if not exists public.finance_reconciliation_rules(
 id uuid primary key default gen_random_uuid(),
 rule_code text not null,
 rule_version int not null default 1,
 purchase_type text not null,
 gst_percent numeric(8,4),
 tolerance numeric(14,2) not null default 1,
 configuration jsonb not null default '{}'::jsonb,
 active boolean not null default true,
 effective_from date not null default current_date,
 effective_to date,
 created_at timestamptz not null default now(),
 unique(rule_code,rule_version)
);

insert into public.finance_reconciliation_rules(rule_code,rule_version,purchase_type,gst_percent,tolerance,configuration)
values('NORMAL_PURCHASE',1,'Indirect Purchase',5,1,'{"formula":"bill_plus_gst_minus_full_rebate_minus_weighment_minus_unloading_minus_tds_minus_other_valid_deductions","money_precision":"paise"}'::jsonb)
on conflict(rule_code,rule_version) do nothing;

create table if not exists public.finance_vendor_aliases(
 id uuid primary key default gen_random_uuid(),
 vendor_master_id text not null,
 alias_normalized text not null unique,
 display_name text,
 active boolean not null default true,
 created_at timestamptz not null default now()
);

create table if not exists public.reconciliation_manual_overrides(
 id uuid primary key default gen_random_uuid(),
 run_id uuid references public.reconciliation_runs(id) on delete cascade,
 reconciliation_type text not null,
 source_key text not null,
 previous_state jsonb not null default '{}'::jsonb,
 selected_candidate jsonb not null default '{}'::jsonb,
 reason text not null,
 selected_by uuid references public.profiles(id),
 selected_at timestamptz not null default now()
);

alter table public.finance_reconciliation_rules enable row level security;
alter table public.finance_vendor_aliases enable row level security;
alter table public.reconciliation_manual_overrides enable row level security;

drop policy if exists finance_rules_read on public.finance_reconciliation_rules;
create policy finance_rules_read on public.finance_reconciliation_rules for select to authenticated using(true);
drop policy if exists finance_aliases_read on public.finance_vendor_aliases;
create policy finance_aliases_read on public.finance_vendor_aliases for select to authenticated using(true);
drop policy if exists finance_manual_review_read on public.reconciliation_manual_overrides;
create policy finance_manual_review_read on public.reconciliation_manual_overrides for select to authenticated using(public.is_management() or public.has_role('finance_user') or public.has_role('finance_manager'));
