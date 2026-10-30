-- SVMA Operations Intelligence — Sales & Fulfilment. Grounded in Sale Order
-- Details.xlsx and Sales Register.xlsx (real headers inspected this
-- session). Availability & Planning (Free-to-Sell / Projected Stock) is
-- computed on read from these plus ops_stock_snapshots — never its own
-- table, per spec section 23's "never show projected as physical."

create table public.ops_sales_orders(
  id uuid primary key default gen_random_uuid(),
  upload_batch_id uuid references public.ops_upload_batches(id) on delete cascade,
  so_no text not null,
  so_date date,
  customer_po_no text,
  customer_name text,
  customer_location text,
  consignee_name text,
  dispatch_location text,
  product_id uuid references public.ops_product_master(id),
  product_raw text not null,
  packing_size text,
  quantity numeric(14,3),
  uom text,
  rate numeric(14,2),
  dispatched_qty numeric(14,3),
  status text,
  gross_amount numeric(16,2),
  total_amount numeric(16,2),
  created_at timestamptz not null default now(),
  unique(so_no, product_raw)
);
create index ops_sales_orders_customer on public.ops_sales_orders(customer_name);
create index ops_sales_orders_status on public.ops_sales_orders(status);

create table public.ops_sales_invoices(
  id uuid primary key default gen_random_uuid(),
  upload_batch_id uuid references public.ops_upload_batches(id) on delete cascade,
  invoice_no text not null,
  so_no text,
  invoice_date date,
  party_name text,
  place text,
  vehicle_no text,
  product_id uuid references public.ops_product_master(id),
  product_raw text not null,
  packing_size text,
  rate numeric(14,2),
  quantity_mt numeric(14,3),
  quantity_kg numeric(14,3),
  plastic_bag numeric(10,2),
  jute_bag numeric(10,2),
  total_bags numeric(10,2),
  amount numeric(16,2),
  tax_amount numeric(16,2),
  total_invoice_amount numeric(16,2),
  created_at timestamptz not null default now(),
  unique(invoice_no, product_raw, packing_size)
);
create index ops_sales_invoices_so on public.ops_sales_invoices(so_no);

alter table public.ops_sales_orders enable row level security;
alter table public.ops_sales_invoices enable row level security;
create policy ops_sales_orders_read on public.ops_sales_orders for select to authenticated using(public.is_management() or public.has_role('ops_operator'));
create policy ops_sales_orders_write on public.ops_sales_orders for all to authenticated using(public.is_management() or public.has_role('ops_operator')) with check(public.is_management() or public.has_role('ops_operator'));
create policy ops_sales_invoices_read on public.ops_sales_invoices for select to authenticated using(public.is_management() or public.has_role('ops_operator'));
create policy ops_sales_invoices_write on public.ops_sales_invoices for all to authenticated using(public.is_management() or public.has_role('ops_operator')) with check(public.is_management() or public.has_role('ops_operator'));
