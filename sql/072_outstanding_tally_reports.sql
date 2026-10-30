-- Creditors / Debtors — Tally's own Outstandings exports (Pending Bills / Group Summary of Sundry Debtors or Sundry Creditors).
-- They are exact as of the date printed, so each upload simply replaces what was there for that side; the screen uses the newest
-- one per side in place of the figures worked out from the Day Book. Older uploads stay for audit.

create table if not exists public.outstanding_tally_reports(
  id uuid primary key default gen_random_uuid(),
  side text not null check (side in ('creditor','debtor')),
  kind text not null check (kind in ('bills','summary')),
  as_of date not null,
  file_name text,
  row_count integer not null default 0,
  rows jsonb not null default '[]'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists outstanding_tally_reports_side on public.outstanding_tally_reports(side, created_at desc);

alter table public.outstanding_tally_reports enable row level security;
create policy outstanding_tally_reports_read on public.outstanding_tally_reports for select to authenticated using(public.is_management() or public.has_role('finance_user') or public.has_role('finance_manager'));
create policy outstanding_tally_reports_write on public.outstanding_tally_reports for all to authenticated using(public.is_management() or public.has_role('finance_user') or public.has_role('finance_manager')) with check(public.is_management() or public.has_role('finance_user') or public.has_role('finance_manager'));
