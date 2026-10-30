-- SVMA Operations Intelligence — 10 previously-unparsed ERP report types.
-- Real headers inspected directly from the actual files this session (not
-- guessed from filenames). Seven are genuinely new information (Brokerage,
-- Consumable Issue, EB Power Reading, Freight Summary, QC Pending Lots,
-- Shut Down, Solvent Daily Report); three deliberately overlap existing
-- domains (Contract List Pending vs ops_sales_orders.so_no; Purchase
-- Summary vs Purchase Register LotWise + Credit_Debit Note List; Inward
-- Payment vs the same payment-ledger domain) and are still captured as
-- independent tables per explicit instruction — no reconciliation against
-- the tables they overlap is implied or built here.

create table public.ops_brokerage(
  id uuid primary key default gen_random_uuid(),
  upload_batch_id uuid references public.ops_upload_batches(id) on delete cascade,
  con_no text not null,
  con_date date,
  broker_name text,
  party_name text,
  grade text,
  calc_type text,
  con_qty numeric(14,3),
  des_rec_qty numeric(14,3),
  per_ton numeric(14,2),
  jute_bag numeric(10,2),
  plastic_bag numeric(10,2),
  total numeric(16,2),
  created_at timestamptz not null default now(),
  unique(con_no)
);

create table public.ops_consumable_issues(
  id uuid primary key default gen_random_uuid(),
  upload_batch_id uuid references public.ops_upload_batches(id) on delete cascade,
  issue_date date,
  reference_no text not null,
  department text,
  product_raw text not null,
  weight numeric(14,3),
  created_at timestamptz not null default now(),
  unique(reference_no, product_raw)
);

create table public.ops_eb_power_readings(
  id uuid primary key default gen_random_uuid(),
  upload_batch_id uuid references public.ops_upload_batches(id) on delete cascade,
  report_date date not null,
  department text not null,
  particulars text not null,
  opening_kwh numeric(14,2),
  closing_kwh numeric(14,2),
  consumption_units numeric(14,2),
  remarks text,
  created_at timestamptz not null default now(),
  unique(report_date, department, particulars)
);
create index ops_eb_power_readings_date on public.ops_eb_power_readings(report_date);

create table public.ops_freight_summary(
  id uuid primary key default gen_random_uuid(),
  upload_batch_id uuid references public.ops_upload_batches(id) on delete cascade,
  invoice_no text not null,
  invoice_date date,
  party_name text,
  invoice_location text,
  vehicle_no text,
  product_raw text,
  invoice_qty numeric(14,3),
  freight_amt_per_ton numeric(14,2),
  created_at timestamptz not null default now(),
  unique(invoice_no)
);

create table public.ops_qc_pending_lots(
  id uuid primary key default gen_random_uuid(),
  upload_batch_id uuid references public.ops_upload_batches(id) on delete cascade,
  reference_no text,
  pending_date date,
  party_name text,
  product_id uuid references public.ops_product_master(id),
  product_raw text,
  lot_no text not null,
  codes text,
  quantity numeric(14,3),
  created_at timestamptz not null default now(),
  unique(lot_no)
);

create table public.ops_shutdowns(
  id uuid primary key default gen_random_uuid(),
  upload_batch_id uuid references public.ops_upload_batches(id) on delete cascade,
  effective_date date not null,
  reason text,
  from_time text,
  to_time text,
  minutes numeric(10,2),
  cumulative text,
  remarks text,
  created_at timestamptz not null default now(),
  unique(effective_date, from_time, to_time)
);

-- Confirmed live the same TIME label can appear more than once within one
-- shift block (two stacked sub-tables, not two separate columns) — row_seq
-- is a per-(date,shift) occurrence counter so real repeated rows are never
-- silently dropped as "duplicates" of each other. Columns beyond the
-- confidently-labeled ones are kept verbatim in `extra` rather than
-- guessed at (see lib/ops/parsers/solventDailyReport.ts).
create table public.ops_solvent_daily_readings(
  id uuid primary key default gen_random_uuid(),
  upload_batch_id uuid references public.ops_upload_batches(id) on delete cascade,
  report_date date not null,
  shift text not null,
  time_slot text not null,
  row_seq int not null default 0,
  spray1_ffa numeric(10,3),
  spray2_ffa numeric(10,3),
  dob_doc_oil_pct numeric(10,3),
  miscella numeric(10,3),
  production_oil_ffa numeric(10,3),
  iv numeric(10,3),
  mv numeric(10,3),
  flash_point numeric(10,3),
  remarks text,
  extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(report_date, shift, time_slot, row_seq)
);
create index ops_solvent_daily_readings_date on public.ops_solvent_daily_readings(report_date);

-- Snapshot report ("As On Date" title, same family as Purchase Order
-- Pending / Settlement Pending) — versioned at the BATCH level via
-- activateSnapshotBatch, not deduped by a per-row unique key.
create table public.ops_contract_pending(
  id uuid primary key default gen_random_uuid(),
  upload_batch_id uuid references public.ops_upload_batches(id) on delete cascade,
  product_id uuid references public.ops_product_master(id),
  product_raw text,
  cont_no text not null,
  cont_date date,
  party_name text,
  place text,
  rate_per_ton numeric(14,2),
  con_qty numeric(14,3),
  des_qty numeric(14,3),
  bal_qty numeric(14,3),
  created_at timestamptz not null default now()
);
create index ops_contract_pending_batch on public.ops_contract_pending(upload_batch_id);

-- Real parent/child row structure: ReferenceNo/PaymentDate/SupplierName/
-- Location/BankName/TotalAmount populate only the first row of a payment
-- group; every following row until the next group carries just its own
-- lot/bill + amount — carried forward by the parser onto every child row.
create table public.ops_inward_payments(
  id uuid primary key default gen_random_uuid(),
  upload_batch_id uuid references public.ops_upload_batches(id) on delete cascade,
  reference_no text not null,
  payment_date date,
  supplier_name text,
  location text,
  bank_name text,
  lot_or_bill_no text not null,
  amount numeric(16,2),
  total_amount numeric(16,2),
  created_at timestamptz not null default now(),
  unique(reference_no, lot_or_bill_no)
);

-- Full real row (purchase detail + credit/debit + payment sections, 38
-- columns in the source) captured as its own independent table — not
-- merged or reconciled against Purchase Register LotWise or the
-- Credit_Debit Note List, per explicit instruction.
create table public.ops_purchase_summary(
  id uuid primary key default gen_random_uuid(),
  upload_batch_id uuid references public.ops_upload_batches(id) on delete cascade,
  purchase_type text,
  po_no text,
  reference_no text not null,
  inward_date date,
  supplier_name text,
  supplier_location text,
  product_id uuid references public.ops_product_master(id),
  product_raw text,
  lot_no text,
  supplier_invoice_no text,
  supplier_invoice_date date,
  value numeric(16,2),
  igst_amount numeric(14,2),
  sgst_amount numeric(14,2),
  cgst_amount numeric(14,2),
  gross_amount numeric(16,2),
  voucher_type text,
  credit_debit_no text,
  credit_date date,
  quality_rebate numeric(14,2),
  rebate_igst numeric(14,2),
  rebate_sgst numeric(14,2),
  rebate_cgst numeric(14,2),
  unloading numeric(14,2),
  weighment numeric(14,2),
  lorry_freight numeric(14,2),
  advance numeric(14,2),
  brokerage numeric(14,2),
  other_expenses numeric(14,2),
  tds numeric(14,2),
  final_value numeric(16,2),
  payable_amount numeric(16,2),
  paid_amount numeric(16,2),
  created_at timestamptz not null default now(),
  unique(reference_no)
);
create index ops_purchase_summary_po on public.ops_purchase_summary(po_no);

alter table public.ops_brokerage enable row level security;
alter table public.ops_consumable_issues enable row level security;
alter table public.ops_eb_power_readings enable row level security;
alter table public.ops_freight_summary enable row level security;
alter table public.ops_qc_pending_lots enable row level security;
alter table public.ops_shutdowns enable row level security;
alter table public.ops_solvent_daily_readings enable row level security;
alter table public.ops_contract_pending enable row level security;
alter table public.ops_inward_payments enable row level security;
alter table public.ops_purchase_summary enable row level security;

create policy ops_brokerage_read on public.ops_brokerage for select to authenticated using(public.is_management() or public.has_role('ops_operator'));
create policy ops_brokerage_write on public.ops_brokerage for all to authenticated using(public.is_management() or public.has_role('ops_operator')) with check(public.is_management() or public.has_role('ops_operator'));

create policy ops_consumable_issues_read on public.ops_consumable_issues for select to authenticated using(public.is_management() or public.has_role('ops_operator'));
create policy ops_consumable_issues_write on public.ops_consumable_issues for all to authenticated using(public.is_management() or public.has_role('ops_operator')) with check(public.is_management() or public.has_role('ops_operator'));

create policy ops_eb_power_readings_read on public.ops_eb_power_readings for select to authenticated using(public.is_management() or public.has_role('ops_operator'));
create policy ops_eb_power_readings_write on public.ops_eb_power_readings for all to authenticated using(public.is_management() or public.has_role('ops_operator')) with check(public.is_management() or public.has_role('ops_operator'));

create policy ops_freight_summary_read on public.ops_freight_summary for select to authenticated using(public.is_management() or public.has_role('ops_operator'));
create policy ops_freight_summary_write on public.ops_freight_summary for all to authenticated using(public.is_management() or public.has_role('ops_operator')) with check(public.is_management() or public.has_role('ops_operator'));

create policy ops_qc_pending_lots_read on public.ops_qc_pending_lots for select to authenticated using(public.is_management() or public.has_role('ops_operator'));
create policy ops_qc_pending_lots_write on public.ops_qc_pending_lots for all to authenticated using(public.is_management() or public.has_role('ops_operator')) with check(public.is_management() or public.has_role('ops_operator'));

create policy ops_shutdowns_read on public.ops_shutdowns for select to authenticated using(public.is_management() or public.has_role('ops_operator'));
create policy ops_shutdowns_write on public.ops_shutdowns for all to authenticated using(public.is_management() or public.has_role('ops_operator')) with check(public.is_management() or public.has_role('ops_operator'));

create policy ops_solvent_daily_readings_read on public.ops_solvent_daily_readings for select to authenticated using(public.is_management() or public.has_role('ops_operator'));
create policy ops_solvent_daily_readings_write on public.ops_solvent_daily_readings for all to authenticated using(public.is_management() or public.has_role('ops_operator')) with check(public.is_management() or public.has_role('ops_operator'));

create policy ops_contract_pending_read on public.ops_contract_pending for select to authenticated using(public.is_management() or public.has_role('ops_operator'));
create policy ops_contract_pending_write on public.ops_contract_pending for all to authenticated using(public.is_management() or public.has_role('ops_operator')) with check(public.is_management() or public.has_role('ops_operator'));

create policy ops_inward_payments_read on public.ops_inward_payments for select to authenticated using(public.is_management() or public.has_role('ops_operator'));
create policy ops_inward_payments_write on public.ops_inward_payments for all to authenticated using(public.is_management() or public.has_role('ops_operator')) with check(public.is_management() or public.has_role('ops_operator'));

create policy ops_purchase_summary_read on public.ops_purchase_summary for select to authenticated using(public.is_management() or public.has_role('ops_operator'));
create policy ops_purchase_summary_write on public.ops_purchase_summary for all to authenticated using(public.is_management() or public.has_role('ops_operator')) with check(public.is_management() or public.has_role('ops_operator'));

-- Contract List Pending is now a snapshot type (versioned per report_date,
-- one active batch at a time) — extend the same partial unique index from
-- sql/054, scoped to the true snapshot types (must match
-- SNAPSHOT_REPORT_TYPES in lib/ops/parsers/index.ts exactly).
begin;
drop index if exists public.erp_upload_batches_one_active_per_date;
create unique index erp_upload_batches_one_active_per_date on public.ops_upload_batches(report_type, report_date)
  where is_active and report_type in ('stock_snapshot', 'rm_batch_stock', 'purchase_order_pending', 'settlement_pending', 'contract_pending');
commit;
