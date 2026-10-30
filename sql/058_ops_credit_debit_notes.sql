-- Operations' own copy of Credit/Debit Note data, joined automatically to
-- lot_no/po_no — gives an automatic "has this lot's supplier been paid"
-- signal that works instantly (doesn't depend on Finance having run their
-- own Purchase Payment Reconciliation first). Sits ALONGSIDE, never
-- replacing, the existing Finance-reconciliation-based payment match in the
-- PO Trace drawer (sourced from reconciliation_runs) — both stay, clearly
-- labeled as two different sources, per explicit instruction. Does not
-- touch or reuse lib/reconcile.ts's parseCreditDebit(), which stays
-- Finance's own separate reconciliation-flow parser.

create table public.ops_credit_debit_notes(
  id uuid primary key default gen_random_uuid(),
  upload_batch_id uuid references public.ops_upload_batches(id) on delete cascade,
  po_no text,
  date date,
  purchase_type text,
  invoice_no text,
  lot_no text,
  reference_number text not null,
  customer_name text,
  product_id uuid references public.ops_product_master(id),
  product_raw text,
  net_weight numeric(14,3),
  final_weight numeric(14,3),
  lab_oil numeric(10,4),
  rep_oil numeric(10,4),
  rate_type text,
  bill_rate numeric(14,2),
  final_rate numeric(14,2),
  jute_bag numeric(10,2),
  pack_rate numeric(14,2),
  pack_cost numeric(14,2),
  value numeric(16,2),
  sgst numeric(14,2),
  cgst numeric(14,2),
  igst numeric(14,2),
  total_gst numeric(14,2),
  weightment numeric(14,2),
  unloading numeric(14,2),
  lorry_freight numeric(14,2),
  advance numeric(14,2),
  brokerage numeric(14,2),
  other_expenses numeric(14,2),
  tds numeric(14,2),
  net_value numeric(16,2),
  bill_value numeric(16,2),
  rebate_value numeric(14,2),
  rebate_igst numeric(14,2),
  rebate_cgst numeric(14,2),
  rebate_sgst numeric(14,2),
  rebate_total_gst numeric(14,2),
  rebate_net_value numeric(14,2),
  created_at timestamptz not null default now(),
  unique(reference_number)
);
create index ops_credit_debit_notes_lot on public.ops_credit_debit_notes(lot_no);
create index ops_credit_debit_notes_po on public.ops_credit_debit_notes(po_no);

alter table public.ops_credit_debit_notes enable row level security;
create policy ops_credit_debit_notes_read on public.ops_credit_debit_notes for select to authenticated using(public.is_management() or public.has_role('ops_operator'));
create policy ops_credit_debit_notes_write on public.ops_credit_debit_notes for all to authenticated using(public.is_management() or public.has_role('ops_operator')) with check(public.is_management() or public.has_role('ops_operator'));
