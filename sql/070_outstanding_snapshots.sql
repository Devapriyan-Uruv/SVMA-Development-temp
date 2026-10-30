-- Creditors / Debtors (Finance) — one snapshot per uploaded Tally Day Book. The computed parties and open bills are kept as
-- JSON so the screen can search and total them without the Day Book being uploaded again. Older snapshots stay for audit;
-- the screen always shows the newest.

create table if not exists public.outstanding_snapshots(
  id uuid primary key default gen_random_uuid(),
  file_name text,
  period_from date,
  period_to date,
  voucher_count integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  parties jsonb not null default '[]'::jsonb,
  bills jsonb not null default '[]'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists outstanding_snapshots_created on public.outstanding_snapshots(created_at desc);

alter table public.outstanding_snapshots enable row level security;
create policy outstanding_snapshots_read on public.outstanding_snapshots for select to authenticated using(public.is_management() or public.has_role('finance_user') or public.has_role('finance_manager'));
create policy outstanding_snapshots_write on public.outstanding_snapshots for all to authenticated using(public.is_management() or public.has_role('finance_user') or public.has_role('finance_manager')) with check(public.is_management() or public.has_role('finance_user') or public.has_role('finance_manager'));
