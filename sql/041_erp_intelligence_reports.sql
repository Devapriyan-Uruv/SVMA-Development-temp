-- ERP Intelligence Phase 1 — parsed report tables.
-- erp_feeding_entries / erp_production_entries: append-only transaction
-- logs (their own reference_no / (reference_no,product_raw,packing) unique
-- constraint is the real per-row business key — a later same-day upload
-- legitimately adds more rows, it never replaces the day).
-- erp_stock_snapshots / erp_rm_batch_stock: versioned via the owning
-- erp_upload_batches.is_active — "current" rows for a date are always
-- reached by joining through an active batch, never by an UPDATE.

create table public.erp_feeding_entries(
  id uuid primary key default gen_random_uuid(),
  upload_batch_id uuid references public.erp_upload_batches(id) on delete cascade,
  reference_no text not null unique,
  report_date date not null,
  shift text,
  time_slot text,
  lot_no text,
  product_id uuid references public.erp_product_master(id),
  product_raw text not null,
  weight_mt numeric(12,3),
  jute_bag numeric(10,2),
  plastic_bag numeric(10,2),
  ss numeric(10,3),
  fiber numeric(10,4),
  moi numeric(10,4),
  moi_rec numeric(10,4),
  lab_oil numeric(10,4),
  lab_oil_rec_pct numeric(10,4),
  reported_oil numeric(10,4),
  r_oil_rec_pct numeric(10,4),
  amount numeric(14,2),
  feeding_pct numeric(10,4),
  row_fingerprint text not null,
  created_at timestamptz not null default now()
);
create index erp_feeding_entries_date on public.erp_feeding_entries(report_date);
create index erp_feeding_entries_lot on public.erp_feeding_entries(lot_no);
create index erp_feeding_entries_product on public.erp_feeding_entries(product_id, report_date);

create table public.erp_production_entries(
  id uuid primary key default gen_random_uuid(),
  upload_batch_id uuid references public.erp_upload_batches(id) on delete cascade,
  reference_no text not null,
  report_date date not null,
  shift text,
  time_slot text,
  product_id uuid references public.erp_product_master(id),
  product_raw text not null,
  packing text,
  quantity numeric(12,3) not null,
  oil numeric(10,4),
  moi numeric(10,4),
  ss_pct numeric(10,4),
  fiber numeric(10,4),
  protein numeric(10,4),
  ffa numeric(10,4),
  iv numeric(10,4),
  tash numeric(10,4),
  pdi numeric(10,4),
  urea numeric(10,4),
  production_pct numeric(10,4),
  description text,
  row_fingerprint text not null,
  created_at timestamptz not null default now(),
  unique(reference_no, product_raw, packing)
);
create index erp_production_entries_date on public.erp_production_entries(report_date);
create index erp_production_entries_product on public.erp_production_entries(product_id, report_date);

create table public.erp_stock_snapshots(
  id uuid primary key default gen_random_uuid(),
  upload_batch_id uuid references public.erp_upload_batches(id) on delete cascade,
  category text not null,
  particulars text not null,
  product_id uuid references public.erp_product_master(id),
  packing_size text,
  packing_name text,
  opening_qty numeric(14,3),
  inward_qty numeric(14,3),
  outward_qty numeric(14,3),
  closing_qty numeric(14,3),
  closing_value numeric(16,2),
  created_at timestamptz not null default now(),
  unique(upload_batch_id, category, particulars, packing_size, packing_name)
);
create index erp_stock_snapshots_product on public.erp_stock_snapshots(product_id);
create index erp_stock_snapshots_batch on public.erp_stock_snapshots(upload_batch_id);

create table public.erp_rm_batch_stock(
  id uuid primary key default gen_random_uuid(),
  upload_batch_id uuid references public.erp_upload_batches(id) on delete cascade,
  lot_no text not null,
  report_date date,
  grade text,
  supplier_name text,
  weight_mt numeric(12,3),
  area text,
  jute_bag numeric(10,2),
  plastic_bag numeric(10,2),
  total_bags numeric(10,2),
  rate numeric(12,2),
  value numeric(16,2),
  created_at timestamptz not null default now(),
  unique(upload_batch_id, lot_no)
);
create index erp_rm_batch_stock_lot on public.erp_rm_batch_stock(lot_no);
create index erp_rm_batch_stock_batch on public.erp_rm_batch_stock(upload_batch_id);

alter table public.erp_feeding_entries enable row level security;
alter table public.erp_production_entries enable row level security;
alter table public.erp_stock_snapshots enable row level security;
alter table public.erp_rm_batch_stock enable row level security;

create policy erp_feeding_entries_read on public.erp_feeding_entries for select to authenticated using(public.is_management() or public.has_role('erp_operator'));
create policy erp_feeding_entries_write on public.erp_feeding_entries for all to authenticated using(public.is_management() or public.has_role('erp_operator')) with check(public.is_management() or public.has_role('erp_operator'));
create policy erp_production_entries_read on public.erp_production_entries for select to authenticated using(public.is_management() or public.has_role('erp_operator'));
create policy erp_production_entries_write on public.erp_production_entries for all to authenticated using(public.is_management() or public.has_role('erp_operator')) with check(public.is_management() or public.has_role('erp_operator'));
create policy erp_stock_snapshots_read on public.erp_stock_snapshots for select to authenticated using(public.is_management() or public.has_role('erp_operator'));
create policy erp_stock_snapshots_write on public.erp_stock_snapshots for all to authenticated using(public.is_management() or public.has_role('erp_operator')) with check(public.is_management() or public.has_role('erp_operator'));
create policy erp_rm_batch_stock_read on public.erp_rm_batch_stock for select to authenticated using(public.is_management() or public.has_role('erp_operator'));
create policy erp_rm_batch_stock_write on public.erp_rm_batch_stock for all to authenticated using(public.is_management() or public.has_role('erp_operator')) with check(public.is_management() or public.has_role('erp_operator'));
