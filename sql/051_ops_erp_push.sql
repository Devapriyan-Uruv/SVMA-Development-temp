-- AIX3 ERP Data Push — automated daily ERP report ingestion. Report
-- catalogue, configurable browser-automation navigation, and sync-run audit
-- trail. Every downloaded report still flows through the EXISTING
-- ops_upload_batches / classify / parse / reconcile pipeline (see
-- lib/ops/erpSync.ts) — these tables track the automation layer sitting in
-- front of it, never a second parallel pipeline.
--
-- No org_id anywhere: this deployment is single-tenant (see
-- sql/040_erp_intelligence_core.sql's own note) — matches every other
-- ops_ table.

create table public.ops_erp_report_catalog(
  id uuid primary key default gen_random_uuid(),
  report_code text not null unique,
  report_name text not null,
  erp_section text not null check (erp_section in ('INWARD','OUTWARD','PRODUCTION','INVENTORY','OTHER','MAINTENANCE')),
  operations_module text not null check (operations_module in ('SUPPLY','PRODUCTION','INVENTORY','SALES','QUALITY_SETTLEMENT','MAINTENANCE')),
  description text,
  ops_report_type text,                 -- matches lib/ops/parsers ReportType when has_parser
  date_filter_type text not null default 'SINGLE_DATE' check (date_filter_type in ('SINGLE_DATE','FROM_TO','AS_ON_DATE','FINANCIAL_YEAR_AND_DATE','NO_DATE')),
  expected_file_type text not null default 'xlsx',
  is_required boolean not null default true,
  enabled boolean not null default true,
  auto_download boolean not null default true,
  aix3_discovery_enabled boolean not null default true,
  processing_priority int not null default 500,
  has_parser boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ops_erp_report_catalog_priority on public.ops_erp_report_catalog(processing_priority) where enabled;

create table public.ops_erp_report_navigation(
  id uuid primary key default gen_random_uuid(),
  report_catalog_id uuid not null references public.ops_erp_report_catalog(id) on delete cascade,
  navigation_steps jsonb not null default '[]'::jsonb,
  date_selector_config jsonb not null default '{}'::jsonb,
  export_config jsonb not null default '{}'::jsonb,
  expected_page_heading text,
  status text not null default 'DISCOVERED' check (status in ('DISCOVERED','TESTED','VERIFIED','REJECTED')),
  active boolean not null default true,
  verified_at timestamptz,
  verified_by uuid references public.profiles(id),
  discovery_reason text,
  discovery_confidence numeric(5,4),
  supersedes_navigation_id uuid references public.ops_erp_report_navigation(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index ops_erp_report_navigation_one_active on public.ops_erp_report_navigation(report_catalog_id) where active;

-- The login sequence is itself just navigation for a synthetic catalog
-- entry — no separate credentials table, no separate step-runner needed.
insert into public.ops_erp_report_catalog(report_code,report_name,erp_section,operations_module,description,date_filter_type,expected_file_type,is_required,enabled,auto_download,aix3_discovery_enabled,processing_priority,has_parser)
values ('__LOGIN__','SVMA ERP Login','OTHER','SUPPLY','Synthetic catalog entry holding the ERP login navigation sequence — never appears in the Daily Operations Pack UI.','NO_DATE','xlsx',true,true,false,false,0,false);

create table public.ops_erp_sync_runs(
  id uuid primary key default gen_random_uuid(),
  sync_code text not null unique,
  report_date date not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  started_by uuid references public.profiles(id),
  status text not null default 'PENDING' check (status in ('PENDING','RUNNING','COMPLETED','COMPLETED_WITH_EXCEPTIONS','FAILED')),
  reports_requested int not null default 0,
  reports_success int not null default 0,
  reports_duplicate int not null default 0,
  reports_no_data int not null default 0,
  reports_failed int not null default 0,
  reports_need_review int not null default 0,
  new_record_count int not null default 0,
  changed_record_count int not null default 0,
  reconciliation_status text,
  exception_count int not null default 0,
  ticket_count int not null default 0,
  metadata jsonb not null default '{}'::jsonb
);
create index ops_erp_sync_runs_date on public.ops_erp_sync_runs(report_date desc);

create table public.ops_erp_sync_report_runs(
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null references public.ops_erp_sync_runs(id) on delete cascade,
  report_catalog_id uuid not null references public.ops_erp_report_catalog(id),
  report_date date not null,
  navigation_id uuid references public.ops_erp_report_navigation(id),
  status text not null default 'PENDING' check (status in ('PENDING','NAVIGATING','PAGE_FOUND','DATE_APPLIED','GENERATING','DOWNLOADING','DOWNLOADED','VALIDATING','PROCESSED','DUPLICATE_SKIPPED','PARTIALLY_NEW','NEW_VERSION','NO_DATA','NEEDS_NAVIGATION_REVIEW','REPORT_MISMATCH','FAILED')),
  started_at timestamptz,
  completed_at timestamptz,
  download_filename text,
  upload_batch_id uuid references public.ops_upload_batches(id),
  file_sha256 text,
  expected_report_type text,
  detected_report_type text,
  classification_confidence numeric(5,4),
  rows_read int,
  rows_inserted int,
  rows_skipped int,
  changed_records int,
  error_code text,
  error_message text,
  retry_count int not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index ops_erp_sync_report_runs_sync on public.ops_erp_sync_report_runs(sync_run_id);
create index ops_erp_sync_report_runs_catalog on public.ops_erp_sync_report_runs(report_catalog_id,report_date desc);

alter table public.ops_erp_report_catalog enable row level security;
alter table public.ops_erp_report_navigation enable row level security;
alter table public.ops_erp_sync_runs enable row level security;
alter table public.ops_erp_sync_report_runs enable row level security;
create policy ops_erp_report_catalog_read on public.ops_erp_report_catalog for select to authenticated using(public.is_management() or public.has_role('ops_operator'));
create policy ops_erp_report_catalog_write on public.ops_erp_report_catalog for all to authenticated using(public.is_management() or public.has_role('ops_operator')) with check(public.is_management() or public.has_role('ops_operator'));
create policy ops_erp_report_navigation_read on public.ops_erp_report_navigation for select to authenticated using(public.is_management() or public.has_role('ops_operator'));
create policy ops_erp_report_navigation_write on public.ops_erp_report_navigation for all to authenticated using(public.is_management() or public.has_role('ops_operator')) with check(public.is_management() or public.has_role('ops_operator'));
create policy ops_erp_sync_runs_read on public.ops_erp_sync_runs for select to authenticated using(public.is_management() or public.has_role('ops_operator'));
create policy ops_erp_sync_runs_write on public.ops_erp_sync_runs for all to authenticated using(public.is_management() or public.has_role('ops_operator')) with check(public.is_management() or public.has_role('ops_operator'));
create policy ops_erp_sync_report_runs_read on public.ops_erp_sync_report_runs for select to authenticated using(public.is_management() or public.has_role('ops_operator'));
create policy ops_erp_sync_report_runs_write on public.ops_erp_sync_report_runs for all to authenticated using(public.is_management() or public.has_role('ops_operator')) with check(public.is_management() or public.has_role('ops_operator'));

-- Report catalogue seed — real report names from the actual SVMA ERP export
-- files inspected this session (/Users/karthikeyan/Downloads/ERP File SVMA/).
-- 15 already have a working parser (has_parser=true, ops_report_type set —
-- these were built and live-tested earlier this session); the rest are
-- catalogued with real names/purpose but no parser yet, so the push
-- downloads+stores them for audit without running them through
-- reconciliation. Credit_Debit Note List is deliberately excluded — it's
-- already owned by Finance's own Payment Reconciliation pipeline.
insert into public.ops_erp_report_catalog(report_code,report_name,erp_section,operations_module,description,ops_report_type,date_filter_type,expected_file_type,is_required,enabled,auto_download,processing_priority,has_parser) values
-- Group 1: Purchase / Inward
('PURCHASE_ORDER_PENDING','PurchaseOrder Pending','INWARD','SUPPLY','Pending PO tonnage/details, as-on-date snapshot.','purchase_order_pending','NO_DATE','xlsx',true,true,true,100,true),
('PURCHASE_DETAILS','Purchase Details','INWARD','SUPPLY','Purchase Order full details (received/pending qty, status).','purchase_details','FROM_TO','xlsx',true,true,true,110,true),
('PURCHASE_REGISTER_LOTWISE','Purchase Register LotWise','INWARD','SUPPLY','Purchase receipt / RN / Lot information.','purchase_receipts','FROM_TO','xlsx',true,true,true,120,true),
('GATE_IN','Gate In Entry','OTHER','SUPPLY','Inward vehicle gate pass, PO, supplier, material, vehicle.','gate_in','FROM_TO','xlsx',true,true,true,130,true),
('TIME_OFFICE_IN','Time Office In Report','OTHER','SUPPLY','Inward weighment — gross/tare/net weight, lot no, gate pass.','time_office_in','FROM_TO','xlsx',true,true,true,140,true),
('INWARD_PAYMENT','InwardPayment','INWARD','SUPPLY','Purchase payment / bank transaction information.',null,'FROM_TO','xlsx',false,true,true,150,false),
-- Group 2: QC / Settlement
('INWARD_QC','Inward QC Report','INWARD','QUALITY_SETTLEMENT','Purchase lot lab report — 3 random samples per lot.','inward_qc','FROM_TO','xlsx',true,true,true,200,true),
('SETTLEMENT_PENDING','SettlementPending Lot','INWARD','QUALITY_SETTLEMENT','Lots awaiting final lab/final rate/settlement.','settlement_pending','NO_DATE','xlsx',true,true,true,210,true),
('QC_PENDING','QCPendingLots','INWARD','QUALITY_SETTLEMENT','Purchase lots where QC/lab is not final.',null,'NO_DATE','xlsx',true,true,true,220,false),
('SETTLEMENT_REPORT','SettlementReport','INWARD','QUALITY_SETTLEMENT','Party / lot settlement details.',null,'FROM_TO','xlsx',false,true,true,230,false),
-- Group 3: Raw Material Stock
('RAW_MATERIAL_BATCH_STOCK','RawMaterialBatchWiseStock','INWARD','INVENTORY','Raw material closing stock by lot, supplier and value.','rm_batch_stock','AS_ON_DATE','xlsx',true,true,true,300,true),
-- Group 4: Feeding
('FEEDING_DETAILS','Feeding Details','PRODUCTION','PRODUCTION','Feeding by product/lot (Rice Bran, Copra, Palm Kernel...).','feeding','FROM_TO','xlsx',true,true,true,400,true),
-- Group 5: Production
('PRODUCTION','Production','PRODUCTION','PRODUCTION','Production output (DORB, DOC, Copra, Palm Kernel, Refined Oil, Wax...).','production','FROM_TO','xlsx',true,true,true,500,true),
-- Group 6: Stock Summary
('STOCK_SUMMARY','Stock Summary with Value','INVENTORY','INVENTORY','Opening/inward/outward/closing stock by product, with value.','stock_snapshot','AS_ON_DATE','xlsx',true,true,true,600,true),
-- Group 7: Sales / Outward
('CONTRACT_PENDING','Contract List Pending','OUTWARD','SALES','Pending sales order / contract quantity.',null,'NO_DATE','xlsx',true,true,true,700,false),
('SALE_ORDER_DETAILS','Sale Order Details','OUTWARD','SALES','Customer / SO / ordered quantity / dispatch information.','sale_order_details','FROM_TO','xlsx',true,true,true,710,true),
('SALES_REGISTER','Sales Register','OUTWARD','SALES','Sales / invoice details.','sales_register','FROM_TO','xlsx',true,true,true,720,true),
('GATE_OUT','Gate Out Entry','OTHER','SALES','Outward vehicle gate pass, customer, products, vehicle.','gate_out','FROM_TO','xlsx',true,true,true,730,true),
('TIME_OFFICE_OUT','Time Office Out Report','OTHER','SALES','Outward weighment — gross/tare/net weight, gate pass.','time_office_out','FROM_TO','xlsx',true,true,true,740,true),
('BROKERAGE','Brokerage','OUTWARD','SALES','Broker charges.',null,'FROM_TO','xlsx',false,true,true,750,false),
('OUTWARD_PAYMENT','OutwardPayment','OUTWARD','SALES','Sales payment / bank transaction details.',null,'FROM_TO','xlsx',false,true,true,760,false),
('FREIGHT_SUMMARY','FreightSummary','OUTWARD','SALES','Lorry freight / transportation details.',null,'FROM_TO','xlsx',false,true,true,770,false),
-- Group 8: Power / Shutdown / Consumables
('CONSUMABLE_ISSUE','Consumable Issue','PRODUCTION','MAINTENANCE','Operational consumables — firewood, hexane, electricity...',null,'FROM_TO','xlsx',false,true,true,800,false),
('EB_POWER','EBPowerReadingReport','MAINTENANCE','MAINTENANCE','Electricity / power consumption.',null,'FROM_TO','pdf',false,true,true,810,false),
('SHUTDOWN','ShutDownDetailsReport','MAINTENANCE','MAINTENANCE','Plant shutdown details.',null,'FROM_TO','xlsx',false,true,true,820,false),
('SOLVENT_DAILY_REPORT','Solvent Daily Report','MAINTENANCE','MAINTENANCE','Solvent lab/process parameters — additional Operations Intelligence data source only; never replaces or modifies the existing Solvent Production Parameters module.',null,'SINGLE_DATE','xlsx',false,true,true,830,false),
('VISITORS_REPORT','Visitors Report','OTHER','MAINTENANCE','Visitor details — low priority for Operations Intelligence.',null,'FROM_TO','xlsx',false,false,false,840,false);

-- Every report (including the login sequence) starts with an empty,
-- unverified navigation config — I cannot personally log into the live ERP
-- to map real selectors (see plan doc). The admin ERP Configuration screen's
-- "Test Navigation" action is how these get filled in and promoted to
-- VERIFIED, per catalog row.
insert into public.ops_erp_report_navigation(report_catalog_id,navigation_steps,date_selector_config,export_config,status)
select id,'[]'::jsonb,'{}'::jsonb,'{}'::jsonb,'DISCOVERED' from public.ops_erp_report_catalog;
