-- SVMA Operations Intelligence — Supply Intelligence: PO -> Gate -> Weighment
-- -> Lot -> QC -> Settlement -> Stock. Business keys grounded in the real
-- sample files inspected this session (PurchaseOrder Pending.xlsx,
-- Purchase Details.xlsx, Gate In/Out Entry.xlsx, Time Office In/Out
-- Report.xlsx — Time Office is the actual weighment record, carrying
-- lot_no on the inward side).

create table public.ops_purchase_orders(
  id uuid primary key default gen_random_uuid(),
  upload_batch_id uuid references public.ops_upload_batches(id) on delete cascade,
  source_report text not null,                 -- 'purchase_order_pending' | 'purchase_details'
  po_no text not null,
  po_date date,
  product_id uuid references public.ops_product_master(id),
  product_raw text not null,
  supplier_name text,
  broker_name text,
  ordered_qty numeric(14,3),
  received_qty numeric(14,3),
  pending_qty numeric(14,3),
  rate numeric(14,2),
  status text,
  created_at timestamptz not null default now(),
  unique(upload_batch_id, po_no, product_raw)
);
create index ops_purchase_orders_po_no on public.ops_purchase_orders(po_no);
create index ops_purchase_orders_supplier on public.ops_purchase_orders(supplier_name);

create table public.ops_gate_movements(
  id uuid primary key default gen_random_uuid(),
  upload_batch_id uuid references public.ops_upload_batches(id) on delete cascade,
  gate_pass_no text not null unique,
  direction text not null check (direction in ('IN','OUT')),
  movement_date date,
  po_no text,
  so_no text,
  party_name text,
  party_address text,
  material_raw text,
  vehicle_no text,
  in_time text,
  out_time text,
  remarks text,
  created_at timestamptz not null default now()
);
create index ops_gate_movements_po on public.ops_gate_movements(po_no);
create index ops_gate_movements_so on public.ops_gate_movements(so_no);
create index ops_gate_movements_vehicle on public.ops_gate_movements(vehicle_no);

create table public.ops_weighments(
  id uuid primary key default gen_random_uuid(),
  upload_batch_id uuid references public.ops_upload_batches(id) on delete cascade,
  gate_pass_no text not null unique,
  direction text not null check (direction in ('IN','OUT')),
  weighment_date date,
  po_no text,
  so_no text,
  lot_no text,
  product_id uuid references public.ops_product_master(id),
  product_raw text,
  party_name text,
  vehicle_no text,
  gunny_bags numeric(10,2),
  plastic_bags numeric(10,2),
  total_bags numeric(10,2),
  gross_weight numeric(12,3),
  tare_weight numeric(12,3),
  net_weight numeric(12,3),
  remarks text,
  created_at timestamptz not null default now()
);
create index ops_weighments_lot on public.ops_weighments(lot_no);
create index ops_weighments_po on public.ops_weighments(po_no);

create table public.ops_purchase_receipts(
  id uuid primary key default gen_random_uuid(),
  upload_batch_id uuid references public.ops_upload_batches(id) on delete cascade,
  purchase_type text,
  rn_no text not null unique,
  rn_date date,
  po_no text,
  lot_no text,
  supplier_name text,
  place text,
  vehicle_no text,
  product_id uuid references public.ops_product_master(id),
  product_raw text,
  bill_no text,
  bill_rate numeric(14,4),
  bill_qty numeric(14,3),
  cgst numeric(14,2),
  sgst numeric(14,2),
  igst numeric(14,2),
  bill_value numeric(16,2),
  weight numeric(12,3),
  jute_bag numeric(10,2),
  plastic_bag numeric(10,2),
  total_bags numeric(10,2),
  freight_amt numeric(14,2),
  created_at timestamptz not null default now()
);
create index ops_purchase_receipts_po on public.ops_purchase_receipts(po_no);
create index ops_purchase_receipts_lot on public.ops_purchase_receipts(lot_no);

create table public.ops_lots(
  id uuid primary key default gen_random_uuid(),
  lot_no text not null unique,
  po_no text,
  gate_pass_no text,
  supplier_name text,
  product_id uuid references public.ops_product_master(id),
  product_raw text,
  status text not null default 'AWAITING_MATERIAL' check (status in ('AWAITING_MATERIAL','AT_GATE','WEIGHED','RECEIPT_CREATED','LOT_CREATED','QC_PENDING','QC_COMPLETED','SETTLEMENT_PENDING','STOCK_POSTED','COMPLETED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ops_lots_po on public.ops_lots(po_no);
create index ops_lots_status on public.ops_lots(status);

alter table public.ops_purchase_orders enable row level security;
alter table public.ops_gate_movements enable row level security;
alter table public.ops_weighments enable row level security;
alter table public.ops_purchase_receipts enable row level security;
alter table public.ops_lots enable row level security;

create policy ops_purchase_orders_read on public.ops_purchase_orders for select to authenticated using(public.is_management() or public.has_role('ops_operator'));
create policy ops_purchase_orders_write on public.ops_purchase_orders for all to authenticated using(public.is_management() or public.has_role('ops_operator')) with check(public.is_management() or public.has_role('ops_operator'));
create policy ops_gate_movements_read on public.ops_gate_movements for select to authenticated using(public.is_management() or public.has_role('ops_operator'));
create policy ops_gate_movements_write on public.ops_gate_movements for all to authenticated using(public.is_management() or public.has_role('ops_operator')) with check(public.is_management() or public.has_role('ops_operator'));
create policy ops_weighments_read on public.ops_weighments for select to authenticated using(public.is_management() or public.has_role('ops_operator'));
create policy ops_weighments_write on public.ops_weighments for all to authenticated using(public.is_management() or public.has_role('ops_operator')) with check(public.is_management() or public.has_role('ops_operator'));
create policy ops_purchase_receipts_read on public.ops_purchase_receipts for select to authenticated using(public.is_management() or public.has_role('ops_operator'));
create policy ops_purchase_receipts_write on public.ops_purchase_receipts for all to authenticated using(public.is_management() or public.has_role('ops_operator')) with check(public.is_management() or public.has_role('ops_operator'));
create policy ops_lots_read on public.ops_lots for select to authenticated using(public.is_management() or public.has_role('ops_operator'));
create policy ops_lots_write on public.ops_lots for all to authenticated using(public.is_management() or public.has_role('ops_operator')) with check(public.is_management() or public.has_role('ops_operator'));
