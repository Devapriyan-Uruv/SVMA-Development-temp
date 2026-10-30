-- Import: contract register (upload → AI extraction → review → confirm), the Settlement sheet and its delivery-date alerts. Safe to re-run.
-- Everything is new; no existing table is changed. All access goes through the server (service role), so RLS is on with no policies.

create table if not exists public.import_contracts(
 id uuid primary key default gen_random_uuid(),
 import_id text not null unique,
 contract_number text not null,
 contract_date text,
 supplier_name text not null,
 supplier_country text,
 buyer_name text,
 product_material_name text,
 grade_description text,
 quantity numeric,
 uom text check (uom is null or uom in ('MT','KG')),
 unit_price numeric,
 currency text,
 total_contract_value numeric,
 shipment_date_period text,
 port_of_loading text,
 port_of_destination text,
 payment_terms text,
 incoterms text,
 other_conditions text,
 status text not null default 'Pending Review' check (status in ('Draft','Pending Review','Confirmed')),
 original_file_name text,
 storage_path text,
 warnings jsonb not null default '[]'::jsonb,
 missing_fields jsonb not null default '[]'::jsonb,
 uncertain_fields jsonb not null default '[]'::jsonb,
 -- Key dates the alerts run on (set on the Settlement page; the shipment end is pre-filled from the contract's shipment period).
 shipment_end_date date,
 eta_date date,
 delivery_date date,
 settlement_due_date date,
 settled_at date,
 -- Optional link to the shipment record in the existing Import entries, and the ERP names the receipts are matched under.
 import_entry_id uuid references public.import_entries(id) on delete set null,
 erp_supplier text,
 erp_product text,
 created_by uuid references public.profiles(id),
 updated_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index if not exists uq_import_contracts_supplier_no on public.import_contracts(lower(supplier_name),lower(contract_number));
create index if not exists idx_import_contracts_status on public.import_contracts(status,created_at desc);

create table if not exists public.import_contract_materials(
 id bigserial primary key,
 contract_id uuid not null references public.import_contracts(id) on delete cascade,
 material_name text,
 grade_description text,
 quantity numeric,
 uom text check (uom is null or uom in ('MT','KG')),
 unit_price numeric,
 currency text,
 contract_value numeric,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists idx_import_contract_materials_c on public.import_contract_materials(contract_id);

create table if not exists public.import_contract_audit(
 id bigserial primary key,
 contract_id uuid not null references public.import_contracts(id) on delete cascade,
 action text not null,
 changed_by uuid references public.profiles(id),
 details jsonb not null default '{}'::jsonb,
 changed_at timestamptz not null default now()
);
create index if not exists idx_import_contract_audit_c on public.import_contract_audit(contract_id,changed_at desc);

-- One row per commercial invoice / Bill of Entry of a contract (the rows of the Settlement sheet).
create table if not exists public.import_contract_invoices(
 id uuid primary key default gen_random_uuid(),
 contract_id uuid not null references public.import_contracts(id) on delete cascade,
 inv_no text not null,
 inv_qty numeric,
 rate_per_ton numeric,
 inv_value_usd numeric,
 adv_paid_usd numeric,
 boe_no text,
 boe_date date,
 assessable_value numeric,
 sort_order int not null default 0,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(contract_id,inv_no)
);
create index if not exists idx_import_contract_invoices_c on public.import_contract_invoices(contract_id,sort_order);

-- A figure typed over the computed one (invoice row optional; load rows use col_key 'load:<RN no>:<field>').
create table if not exists public.import_contract_cells(
 id bigserial primary key,
 contract_id uuid not null references public.import_contracts(id) on delete cascade,
 invoice_id uuid references public.import_contract_invoices(id) on delete cascade,
 col_key text not null,
 value numeric,
 note text,
 updated_by uuid references public.profiles(id),
 updated_at timestamptz not null default now()
);
create unique index if not exists uq_import_contract_cells on public.import_contract_cells(contract_id,coalesce(invoice_id,'00000000-0000-0000-0000-000000000000'::uuid),col_key);

-- The person's decision on a suggested match: a Day Book voucher line ('tally', ref_key = voucher key|line no, col_key = sheet column)
-- or an ERP receipt ('erp', ref_key = RN no). status 'confirmed' includes it, 'excluded' removes it.
create table if not exists public.import_contract_links(
 id bigserial primary key,
 contract_id uuid not null references public.import_contracts(id) on delete cascade,
 kind text not null check (kind in ('tally','erp')),
 ref_key text not null,
 col_key text,
 status text not null default 'confirmed' check (status in ('confirmed','excluded')),
 decided_by uuid references public.profiles(id),
 decided_at timestamptz not null default now(),
 unique(contract_id,kind,ref_key)
);

alter table public.import_contracts enable row level security;
alter table public.import_contract_materials enable row level security;
alter table public.import_contract_audit enable row level security;
alter table public.import_contract_invoices enable row level security;
alter table public.import_contract_cells enable row level security;
alter table public.import_contract_links enable row level security;
