-- ERP Intelligence Phase 1 — core tables: product master, product/lot alias
-- mapping (AI may suggest, a human must approve before reconciliation ever
-- resolves through one), and the upload-batch tracker that every parser/
-- reconciliation table below hangs off of. No org_id — this deployment is
-- single-tenant (confirmed: no org_id column anywhere in sql/), RLS uses the
-- existing has_role()/is_management() helpers exactly like every other table.

create table public.erp_product_master(
  id uuid primary key default gen_random_uuid(),
  product_code text unique not null,
  display_name text not null,
  category text,
  uom text not null default 'MT',
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.erp_product_aliases(
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.erp_product_master(id) on delete cascade,
  report_type text not null,
  source_text text not null,
  source_text_normalized text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  suggested_by text not null default 'ai' check (suggested_by in ('ai','human')),
  confidence numeric(5,4),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique(report_type, source_text_normalized)
);

create table public.erp_lot_aliases(
  id uuid primary key default gen_random_uuid(),
  feeding_lot_no text not null,
  rm_batch_lot_no text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  suggested_by text not null default 'ai' check (suggested_by in ('ai','human')),
  confidence numeric(5,4),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique(feeding_lot_no, rm_batch_lot_no)
);

create table public.erp_upload_batches(
  id uuid primary key default gen_random_uuid(),
  report_type text not null,
  report_date date,
  file_name text not null,
  storage_path text not null,
  file_sha256 text not null,
  file_size bigint,
  row_count int not null default 0,
  new_row_count int not null default 0,
  duplicate_row_count int not null default 0,
  correction_flagged_count int not null default 0,
  status text not null default 'processing' check (status in ('processing','completed','completed_with_errors','failed','duplicate_file')),
  error_summary jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  version_no int not null default 1,
  supersedes_batch_id uuid references public.erp_upload_batches(id),
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(report_type, file_sha256)
);
-- Structural guarantee (not just app logic): at most one active snapshot
-- batch per report_type+report_date. Enforced regardless of report_type;
-- append-only report types (feeding/production) simply never flip
-- is_active=false on an older batch, so this never blocks their re-uploads.
create unique index erp_upload_batches_one_active_per_date on public.erp_upload_batches(report_type, report_date) where is_active;
create index erp_upload_batches_report_type_date on public.erp_upload_batches(report_type, report_date);

insert into storage.buckets(id,name,public) values('svma-erp-raw','svma-erp-raw',false) on conflict(id) do nothing;

alter table public.erp_product_master enable row level security;
alter table public.erp_product_aliases enable row level security;
alter table public.erp_lot_aliases enable row level security;
alter table public.erp_upload_batches enable row level security;

create policy erp_product_master_read on public.erp_product_master for select to authenticated using(public.is_management() or public.has_role('erp_operator'));
create policy erp_product_master_write on public.erp_product_master for all to authenticated using(public.is_management() or public.has_role('erp_operator')) with check(public.is_management() or public.has_role('erp_operator'));
create policy erp_product_aliases_read on public.erp_product_aliases for select to authenticated using(public.is_management() or public.has_role('erp_operator'));
create policy erp_product_aliases_write on public.erp_product_aliases for all to authenticated using(public.is_management() or public.has_role('erp_operator')) with check(public.is_management() or public.has_role('erp_operator'));
create policy erp_lot_aliases_read on public.erp_lot_aliases for select to authenticated using(public.is_management() or public.has_role('erp_operator'));
create policy erp_lot_aliases_write on public.erp_lot_aliases for all to authenticated using(public.is_management() or public.has_role('erp_operator')) with check(public.is_management() or public.has_role('erp_operator'));
create policy erp_upload_batches_read on public.erp_upload_batches for select to authenticated using(public.is_management() or public.has_role('erp_operator'));
create policy erp_upload_batches_write on public.erp_upload_batches for all to authenticated using(public.is_management() or public.has_role('erp_operator')) with check(public.is_management() or public.has_role('erp_operator'));
