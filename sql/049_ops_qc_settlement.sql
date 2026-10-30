-- SVMA Operations Intelligence — Quality & Settlement Intelligence.
-- Grounded in Inward QC Report.xlsx (3 repeated random-sample blocks per
-- lot, exploded into one row per sample — same pattern as Production's
-- packing columns and Feeding's per-lot rows) and SettlementPending
-- Lot.xlsx. This module is entirely ERP-upload-derived and never touches
-- the operational Quality module's parameter_entries/deviations tables.

create table public.ops_qc_results(
  id uuid primary key default gen_random_uuid(),
  upload_batch_id uuid references public.ops_upload_batches(id) on delete cascade,
  reference_no text,
  lot_no text not null,
  report_date date,
  product_id uuid references public.ops_product_master(id),
  product_raw text,
  supplier_name text,
  sample_code text not null,
  calcium numeric(10,4),
  ffa numeric(10,4),
  fiber numeric(10,4),
  iv numeric(10,4),
  moi numeric(10,4),
  oil numeric(10,4),
  protein numeric(10,4),
  ss numeric(10,4),
  created_at timestamptz not null default now(),
  unique(lot_no, sample_code)
);
create index ops_qc_results_lot on public.ops_qc_results(lot_no);
create index ops_qc_results_date on public.ops_qc_results(report_date);

create table public.ops_settlements(
  id uuid primary key default gen_random_uuid(),
  upload_batch_id uuid references public.ops_upload_batches(id) on delete cascade,
  reference_no text not null,
  purchase_type text,
  inward_date date,
  lot_no text,
  product_id uuid references public.ops_product_master(id),
  product_raw text,
  supplier_name text,
  quantity numeric(14,3),
  ffa numeric(10,4),
  fiber numeric(10,4),
  iv numeric(10,4),
  moi numeric(10,4),
  oil numeric(10,4),
  ss numeric(10,4),
  created_at timestamptz not null default now(),
  unique(upload_batch_id, reference_no)
);
create index ops_settlements_lot on public.ops_settlements(lot_no);
create index ops_settlements_reference on public.ops_settlements(reference_no);

alter table public.ops_qc_results enable row level security;
alter table public.ops_settlements enable row level security;
create policy ops_qc_results_read on public.ops_qc_results for select to authenticated using(public.is_management() or public.has_role('ops_operator'));
create policy ops_qc_results_write on public.ops_qc_results for all to authenticated using(public.is_management() or public.has_role('ops_operator')) with check(public.is_management() or public.has_role('ops_operator'));
create policy ops_settlements_read on public.ops_settlements for select to authenticated using(public.is_management() or public.has_role('ops_operator'));
create policy ops_settlements_write on public.ops_settlements for all to authenticated using(public.is_management() or public.has_role('ops_operator')) with check(public.is_management() or public.has_role('ops_operator'));
