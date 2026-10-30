-- ERP Report API (MenThee MTReport v2) — daily consolidation. The three reports are pulled every day and kept here:
--   payments and purchase documents accumulate (a row already saved is left alone, an edited one is updated, a new one is added), and
--   the pending purchase contracts are kept as one snapshot per day, so the open-contract history can be seen over time.
-- Nothing here touches the uploaded-report tables (ops_*): the API data is a separate, labelled source.

create table if not exists public.erp_api_payments(
  row_key text primary key,                     -- payment reference | supplier id | lot | payment date | occurrence
  payment_ref text not null,
  payment_date date not null,
  bank_name text,
  supplier_id integer,
  supplier_name text,
  supplier_location text,
  lot_number text,
  amount numeric(16,2),
  total_amount numeric(16,2),
  company_id text,
  row_hash text not null,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists erp_api_payments_date on public.erp_api_payments(payment_date);
create index if not exists erp_api_payments_supplier on public.erp_api_payments(supplier_name);

create table if not exists public.erp_api_purchase_docs(
  row_key text primary key,                     -- document number | material | supplier | occurrence
  title text,
  po_number text not null,
  po_date date,
  supplier_name text,
  material_name text,
  ordered_qty numeric(16,3),
  quantity_kg numeric(16,3),
  rate numeric(16,2),
  taxable_amt numeric(16,2),
  tax_amount numeric(16,2),
  total_amount numeric(16,2),
  location_name text,
  status text,
  raw jsonb not null default '{}'::jsonb,
  row_hash text not null,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists erp_api_purchase_docs_date on public.erp_api_purchase_docs(po_date);

create table if not exists public.erp_api_pending_contracts(
  snapshot_date date not null,
  contract_no text not null,
  product_name text not null default '',
  contract_date date,
  party_name text,
  broker_name text,
  contract_qty numeric(16,3),
  received_qty numeric(16,3),
  balance_qty numeric(16,3),
  rate numeric(16,2),
  primary key (snapshot_date, contract_no, product_name)
);

create table if not exists public.erp_api_sync_runs(
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  trigger text not null default 'manual',       -- 'schedule' | 'manual'
  status text not null default 'running',       -- running | completed | partial | failed
  details jsonb not null default '{}'::jsonb,
  error text
);
create index if not exists erp_api_sync_runs_started on public.erp_api_sync_runs(started_at desc);

alter table public.erp_api_payments enable row level security;
alter table public.erp_api_purchase_docs enable row level security;
alter table public.erp_api_pending_contracts enable row level security;
alter table public.erp_api_sync_runs enable row level security;
create policy erp_api_payments_read on public.erp_api_payments for select to authenticated using(public.is_management() or public.has_role('ops_operator'));
create policy erp_api_purchase_docs_read on public.erp_api_purchase_docs for select to authenticated using(public.is_management() or public.has_role('ops_operator'));
create policy erp_api_pending_contracts_read on public.erp_api_pending_contracts for select to authenticated using(public.is_management() or public.has_role('ops_operator'));
create policy erp_api_sync_runs_read on public.erp_api_sync_runs for select to authenticated using(public.is_management() or public.has_role('ops_operator'));
