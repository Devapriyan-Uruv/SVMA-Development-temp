-- V8.7: Import / Export trade module.
-- Two separate transactional modules (Import, Export) sharing one Party
-- master (a single "supplier or customer" form, per the request — a
-- party_type flag, not two separate tables) and an admin-configurable cost
-- category list per commodity/module, so Finance can add a new charge line
-- (e.g. "Fumigation" on Soya Bean) without a code change. Modeled directly
-- off five real working sheets (contract → advance/LC → shipment/BL →
-- invoice/BOE → buyer's-credit/settlement, plus a fixed landed-cost
-- breakdown per shipment) rather than a generic guess. Additive only.

-- One master for both sides of a trade relationship — the form always
-- asks "supplier or customer", never two separate screens.
create table if not exists public.trade_parties(
 id uuid primary key default gen_random_uuid(),
 party_type text not null,
 name text not null,
 country text,
 contact_person text,
 phone text,
 email text,
 bank_name text,
 bank_account_no text,
 bank_swift text,
 tax_id text,
 notes text,
 active boolean not null default true,
 created_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint trade_parties_type_chk check (party_type in ('supplier','customer'))
);
create index if not exists idx_trade_parties_type on public.trade_parties(party_type,active);

create table if not exists public.trade_commodities(
 id bigserial primary key,
 name text not null unique,
 unit text not null default 'MT',
 active boolean not null default true
);

-- The configurable line-item list. commodity_id null = applies to every
-- commodity in that module (today's baseline, lifted straight from the
-- sheets); a non-null commodity_id is an extra line that only shows up for
-- that one commodity (this is the "add Fumigation to Soya Bean only" path,
-- managed from the module's own admin tab, not a migration).
create table if not exists public.trade_cost_categories(
 id bigserial primary key,
 module text not null,
 commodity_id bigint references public.trade_commodities(id) on delete cascade,
 name text not null,
 sort_order int not null default 0,
 active boolean not null default true,
 constraint trade_cost_categories_module_chk check (module in ('import','export'))
);
create index if not exists idx_trade_cost_categories_lookup on public.trade_cost_categories(module,commodity_id,sort_order);
-- 0 stands in for "no commodity" (commodity ids start at 1) purely so the
-- uniqueness check below can treat every generic row as comparable — plain
-- NULL would never conflict with itself and the seed below would duplicate
-- on every re-run.
create unique index if not exists idx_trade_cost_categories_uq on public.trade_cost_categories(module,coalesce(commodity_id,0),name);

-- Sole-reference auto numbering — "IMP-2026-0001" / "EXP-2026-0001" — one
-- counter per module per calendar year. The upsert+returning round-trip
-- is race-safe under concurrent inserts (two people saving an entry at the
-- same instant can never receive the same sequence number).
create table if not exists public.trade_ref_sequences(
 module text not null,
 year int not null,
 last_seq int not null default 0,
 primary key(module,year)
);
create or replace function public.generate_trade_ref_code(p_module text) returns text
language plpgsql as $$
declare v_year int:=extract(year from now())::int; v_seq int; v_prefix text;
begin
 insert into public.trade_ref_sequences(module,year,last_seq) values(p_module,v_year,1)
  on conflict(module,year) do update set last_seq=public.trade_ref_sequences.last_seq+1
  returning last_seq into v_seq;
 v_prefix:=case p_module when 'import' then 'IMP' when 'export' then 'EXP' else upper(p_module) end;
 return v_prefix||'-'||v_year||'-'||lpad(v_seq::text,4,'0');
end;
$$;

-- One row per shipment/contract, covering the full lifecycle traced across
-- the Import Master template and the real SETTLEMENT/Sheet1 ledgers:
-- contract -> advance -> LC -> shipment/BL -> invoice -> Bill of Entry
-- (customs) -> Buyer's Credit -> settlement -> broker commission.
-- "Bill collection charges" (a bank courier/collection fee when the
-- documents arrive) and "Buyer's Credit" (the actual trade-finance
-- facility, with its own issue/due/close dates and interest) are two
-- different things in the source sheets and stay two different sets of
-- columns here — collapsing them was a real risk of confusing a bank fee
-- with an outstanding finance liability.
create table if not exists public.import_entries(
 id uuid primary key default gen_random_uuid(),
 ref_code text not null unique,
 broker_name text,
 party_id uuid references public.trade_parties(id),
 commodity_id bigint references public.trade_commodities(id),
 country text,
 contract_no text,
 contract_date date,
 contract_qty numeric,
 rate_per_ton numeric,
 currency text not null default 'USD',
 contract_value_fcy numeric,
 payment_terms text,
 advance_pct numeric,
 advance_amount_fcy numeric,
 advance_ref_no text,
 advance_date date,
 exchange_rate numeric,
 advance_value_inr numeric,
 lc_no text,
 lc_type text,
 lc_opening_date date,
 lc_expiry_date date,
 lc_amount_fcy numeric,
 shipment_period text,
 shipper_name text,
 port_of_loading text,
 bl_awb_no text,
 bl_date date,
 no_of_containers text,
 arrival_date date,
 invoice_no text,
 invoice_date date,
 invoice_qty numeric,
 invoice_value_fcy numeric,
 balance_amount_fcy numeric,
 bill_ref_no text,
 bill_collection_date date,
 bill_collection_charges_inr numeric,
 boe_no text,
 boe_date date,
 boe_paid_date date,
 boe_amount_inr numeric,
 assessable_value_inr numeric,
 basic_customs_duty_inr numeric,
 sws_other_duty_inr numeric,
 import_igst_inr numeric,
 other_customs_charges_inr numeric,
 settlement_date date,
 settlement_fx_rate numeric,
 settlement_value_inr numeric,
 converted_to_bc boolean not null default false,
 bc_no text,
 bc_issue_date date,
 bc_principal_inr numeric,
 bc_due_date date,
 bc_interest_rate numeric,
 bc_interest_accrued_inr numeric,
 bc_interest_paid_inr numeric,
 bc_close_charges_inr numeric,
 bc_closed boolean not null default false,
 bc_closed_date date,
 broker_commission_fcy numeric,
 broker_commission_inr numeric,
 status text not null default 'contract_received',
 documents_complete boolean not null default false,
 exceptions_notes text,
 cfo_comments text,
 created_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint import_entries_status_chk check (status in ('contract_received','lc_opened','shipped','arrived','boe_filed','cleared','bc_open','settled','closed'))
);
create index if not exists idx_import_entries_status on public.import_entries(status,created_at desc);
create index if not exists idx_import_entries_party on public.import_entries(party_id);
create index if not exists idx_import_entries_commodity on public.import_entries(commodity_id);

create table if not exists public.import_cost_lines(
 id bigserial primary key,
 import_entry_id uuid not null references public.import_entries(id) on delete cascade,
 cost_category_id bigint not null references public.trade_cost_categories(id),
 value numeric not null default 0,
 gst numeric not null default 0,
 note text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint import_cost_lines_uq unique(import_entry_id,cost_category_id)
);

-- Mirrors the Export Tracking sheet's own lifecycle and its own 14-stage
-- status taxonomy (Status List tab) and CFO Review Points, condensed from
-- 63 flat columns into the same logically-grouped shape used for imports.
create table if not exists public.export_entries(
 id uuid primary key default gen_random_uuid(),
 ref_code text not null unique,
 party_id uuid references public.trade_parties(id),
 commodity_id bigint references public.trade_commodities(id),
 country text,
 incoterm text,
 port_of_loading text,
 port_of_discharge text,
 mode text,
 currency text not null default 'USD',
 contract_no text,
 contract_date date,
 contract_qty numeric,
 contract_value_fcy numeric,
 advance_pct numeric,
 advance_amount_fcy numeric,
 balance_amount_fcy numeric,
 lc_or_nonlc text,
 lc_no text,
 lc_date date,
 lc_type text,
 lc_amount_fcy numeric,
 lc_expiry_date date,
 latest_shipment_date date,
 amendment_details text,
 pc_amount_inr numeric,
 pc_date date,
 goods_ready_date date,
 shipment_invoice_no text,
 invoice_date date,
 invoice_value_fcy numeric,
 shipping_bill_no text,
 shipping_bill_date date,
 bl_awb_no text,
 bl_date date,
 actual_shipment_date date,
 etd date,
 eta date,
 docs_submitted_date date,
 export_bill_no text,
 bill_date date,
 bill_type text,
 bill_amount_fcy numeric,
 bank_ad_code text,
 bc_converted_date date,
 due_date date,
 realisation_date date,
 realised_amount_fcy numeric,
 exchange_rate numeric,
 exchange_difference_inr numeric,
 bank_charges_inr numeric,
 interest_rate numeric,
 interest_amount_inr numeric,
 customs_duty_inr numeric,
 igst_refund_inr numeric,
 other_incentives_inr numeric,
 reason_for_delay text,
 follow_up_action text,
 responsible_person uuid references public.profiles(id),
 status text not null default 'contract_received',
 management_comments text,
 created_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint export_entries_status_chk check (status in ('contract_received','lc_awaited','lc_received','goods_in_production','goods_ready','shipped','documents_submitted','bill_purchased','realisation_awaited','partly_realised','fully_realised','overdue','closed'))
);
create index if not exists idx_export_entries_status on public.export_entries(status,created_at desc);
create index if not exists idx_export_entries_party on public.export_entries(party_id);
create index if not exists idx_export_entries_commodity on public.export_entries(commodity_id);

create table if not exists public.export_cost_lines(
 id bigserial primary key,
 export_entry_id uuid not null references public.export_entries(id) on delete cascade,
 cost_category_id bigint not null references public.trade_cost_categories(id),
 value numeric not null default 0,
 gst numeric not null default 0,
 note text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint export_cost_lines_uq unique(export_entry_id,cost_category_id)
);

-- Seed data: commodities actually named across the five sheets, plus the
-- generic (commodity_id null = "every commodity") cost line taxonomy read
-- straight off PRECOST / CORPA CAKE / SOYA BEAN / PKE / "export cost".
insert into public.trade_commodities(name,unit) values
 ('Copra Cake','MT'),('Soya Bean','MT'),('PKE / CPKO','MT'),('Rice Bran','MT'),('Other','MT')
on conflict (name) do nothing;

insert into public.trade_cost_categories(module,commodity_id,name,sort_order) values
 ('import',null,'Purchase Value',10),
 ('import',null,'Documents Charges',20),
 ('import',null,'Bill of Entry / Customs Duty',30),
 ('import',null,'Bank Charges / Bill Collection',40),
 ('import',null,'Insurance',50),
 ('import',null,'Liner Charges',60),
 ('import',null,'CFS Charges',70),
 ('import',null,'Clearance Charges',80),
 ('import',null,'PQ Clearance',90),
 ('import',null,'PQ Fees',100),
 ('import',null,'CHA Expenses',110),
 ('import',null,'Handling / Additional Charges',120),
 ('import',null,'FSSAI / Survey Charges',130),
 ('import',null,'Lorry Freight',140),
 ('import',null,'Demurrage / Brokerage',150)
on conflict (module,coalesce(commodity_id,0),name) do nothing;

insert into public.trade_cost_categories(module,commodity_id,name,sort_order) values
 ('export',null,'CHA Expenses',10),
 ('export',null,'CFS Charges',20),
 ('export',null,'All Charges',30),
 ('export',null,'Weighment',40),
 ('export',null,'Fumigation',50),
 ('export',null,'Transport (Inland)',60),
 ('export',null,'Ocean Freight',70),
 ('export',null,'THC (Terminal Handling)',80),
 ('export',null,'MUC',90),
 ('export',null,'Seal Charges',100),
 ('export',null,'Feeder Charges',110),
 ('export',null,'BL Charges',120),
 ('export',null,'BL Surrender Charges',130),
 ('export',null,'Lab / Testing Fees',140),
 ('export',null,'Certificate Fees',150)
on conflict (module,coalesce(commodity_id,0),name) do nothing;
