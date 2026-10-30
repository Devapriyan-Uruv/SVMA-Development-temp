-- One Reconciliation System — persistence for the consolidated master
-- dataset. Replaces the interim e2e_reconciliation_* tables from 060 (left in
-- place and untouched; they can be dropped whenever convenient). Also entirely
-- separate from the existing Transaction Reconciliation tables.

create table if not exists public.one_reconciliation_runs(
  id uuid primary key default gen_random_uuid(),
  run_code text not null,
  reconciliation_date date,
  status text not null default 'completed',
  run_by uuid,
  summary jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  understanding jsonb not null default '[]'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists one_reconciliation_runs_date on public.one_reconciliation_runs(reconciliation_date);

create table if not exists public.one_reconciliation_transactions(
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.one_reconciliation_runs(id) on delete cascade,
  recon_id text not null,
  transaction_type text not null,
  transaction_date date,
  primary_status text not null,
  statuses text[] not null default '{}',
  vehicle_no text, party_name text, material_raw text,
  master_product_id uuid references public.ops_product_master(id),
  lot_no text, gate_pass_no text,
  master jsonb not null default '{}'::jsonb,
  audit jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists one_reconciliation_transactions_run on public.one_reconciliation_transactions(run_id);
create index if not exists one_reconciliation_transactions_status on public.one_reconciliation_transactions(primary_status);
create index if not exists one_reconciliation_transactions_statuses on public.one_reconciliation_transactions using gin(statuses);
create index if not exists one_reconciliation_transactions_lot on public.one_reconciliation_transactions(lot_no);

alter table public.one_reconciliation_runs enable row level security;
alter table public.one_reconciliation_transactions enable row level security;
create policy one_reconciliation_runs_read on public.one_reconciliation_runs for select to authenticated using(public.is_management() or public.has_role('finance_user') or public.has_role('finance_manager'));
create policy one_reconciliation_runs_write on public.one_reconciliation_runs for all to authenticated using(public.is_management() or public.has_role('finance_user') or public.has_role('finance_manager')) with check(public.is_management() or public.has_role('finance_user') or public.has_role('finance_manager'));
create policy one_reconciliation_transactions_read on public.one_reconciliation_transactions for select to authenticated using(public.is_management() or public.has_role('finance_user') or public.has_role('finance_manager'));
create policy one_reconciliation_transactions_write on public.one_reconciliation_transactions for all to authenticated using(public.is_management() or public.has_role('finance_user') or public.has_role('finance_manager')) with check(public.is_management() or public.has_role('finance_user') or public.has_role('finance_manager'));
