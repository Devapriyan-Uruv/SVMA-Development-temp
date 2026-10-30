-- SVMA V2 proper workflow upgrade. Safe to run after the earlier V1 SQL.
alter table public.reconciliation_runs add column if not exists reconciliation_type text not null default 'transaction';
alter table public.parameter_entries add column if not exists timeliness_status text;
alter table public.parameter_entries add column if not exists validation_status text;
alter table public.parameter_master add column if not exists source_review_required boolean not null default false;
alter table public.parameter_master add column if not exists source_text text;
create unique index if not exists uq_deviation_entry on public.deviations(entry_id) where entry_id is not null;
create index if not exists idx_parameter_frequency on public.parameter_master(frequency,active);
create index if not exists idx_shift_operator_status on public.shift_sessions(operator_id,status);
create index if not exists idx_recon_type_date on public.reconciliation_runs(reconciliation_type,reconciliation_date desc);

create or replace function public.increment_shift_focus_violation(p_shift_session_id uuid)
returns void language sql security definer set search_path=public as $$
  update public.shift_sessions set focus_violations=coalesce(focus_violations,0)+1 where id=p_shift_session_id;
$$;

grant execute on function public.increment_shift_focus_violation(uuid) to authenticated, service_role;

-- Allow authenticated users to read their own role for server-side route authorization.
drop policy if exists roles_self_read on public.user_roles;
create policy roles_self_read on public.user_roles for select to authenticated using(user_id=auth.uid());
