-- "End to End Reconciliation" — a brand-new Finance feature, entirely
-- separate from the existing Transaction Reconciliation (reconciliation_runs
-- / reconciliation_transactions, backing lib/reconciliation/* and
-- app/finance/transaction/page.tsx, which this feature does not touch).
-- Product-Master-driven classification + a full Gate->PO/SO->Lot->QC->
-- Settlement->Credit/Debit Note->Tally chain walk against the Operations
-- tables built earlier this session.

create table public.e2e_reconciliation_runs(
  id uuid primary key default gen_random_uuid(),
  reconciliation_date date not null,
  status text not null default 'completed',
  run_by uuid,
  summary jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index e2e_reconciliation_runs_date on public.e2e_reconciliation_runs(reconciliation_date);

create table public.e2e_reconciliation_transactions(
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.e2e_reconciliation_runs(id) on delete cascade,
  recon_id text not null,
  weighment_ref text, transaction_date date, vehicle_no text, party_name text,
  material_raw text, net_weight numeric(14,3),
  -- Product Master match (never silently replaces material_raw above)
  product_normalized text, master_product_id uuid references public.ops_product_master(id),
  master_product_name text, master_category text, match_method text, match_confidence numeric(5,4),
  ai_suggested_product_id uuid references public.ops_product_master(id), ai_suggestion_confidence numeric(5,4),
  -- Purchase/Sales/Inter-Job Work/Others separation
  category text not null, category_reason text,
  -- Chain: Gate -> PO/SO -> Lot -> QC -> Settlement -> Credit/Debit Note -> Tally
  gate_pass_no text, gate_direction text, gate_order text, gate_matched boolean not null default false, gate_score numeric(6,2),
  po_no text, po_found boolean not null default false,
  so_no text, so_found boolean not null default false,
  lot_no text, lot_found boolean not null default false, lot_source text,
  qc_found boolean not null default false, qc_sample_count int not null default 0,
  settlement_found boolean not null default false,
  credit_debit_reference text, credit_debit_net_value numeric(16,2), credit_debit_bill_value numeric(16,2),
  qc_oil_applicable boolean not null default false, inward_qc_oil numeric(10,4), report_oil numeric(10,4), oil_difference numeric(10,4), qc_oil_status text,
  tally_vch_no text, tally_vch_type text, tally_matched boolean not null default false, tally_score numeric(6,2),
  recon_status text not null,
  notes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index e2e_reconciliation_transactions_run on public.e2e_reconciliation_transactions(run_id);
create index e2e_reconciliation_transactions_status on public.e2e_reconciliation_transactions(recon_status);
create index e2e_reconciliation_transactions_lot on public.e2e_reconciliation_transactions(lot_no);
create index e2e_reconciliation_transactions_product on public.e2e_reconciliation_transactions(master_product_id);

alter table public.e2e_reconciliation_runs enable row level security;
alter table public.e2e_reconciliation_transactions enable row level security;
create policy e2e_reconciliation_runs_read on public.e2e_reconciliation_runs for select to authenticated using(public.is_management() or public.has_role('finance_user') or public.has_role('finance_manager'));
create policy e2e_reconciliation_runs_write on public.e2e_reconciliation_runs for all to authenticated using(public.is_management() or public.has_role('finance_user') or public.has_role('finance_manager')) with check(public.is_management() or public.has_role('finance_user') or public.has_role('finance_manager'));
create policy e2e_reconciliation_transactions_read on public.e2e_reconciliation_transactions for select to authenticated using(public.is_management() or public.has_role('finance_user') or public.has_role('finance_manager'));
create policy e2e_reconciliation_transactions_write on public.e2e_reconciliation_transactions for all to authenticated using(public.is_management() or public.has_role('finance_user') or public.has_role('finance_manager')) with check(public.is_management() or public.has_role('finance_user') or public.has_role('finance_manager'));
