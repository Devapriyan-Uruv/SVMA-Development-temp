-- SVMA Operations Intelligence — renames the erp_* tables (built as ERP
-- Intelligence Phase 1, live with real data) to ops_* for schema
-- consistency with the broader Operations Intelligence build. This is a
-- metadata-only rename (Postgres RENAME TO does not rewrite data — fast,
-- safe) but MUST be applied in the same deploy window as the matching
-- application code (lib/ops/*, app/api/ops/*, app/operations/*), or the
-- live app will point at table names that no longer exist. Apply this
-- immediately before/alongside deploying that code, not standalone.
--
-- Index/constraint/policy NAMES are deliberately left as-is (still fully
-- functional against the renamed table — Postgres tracks these by object
-- id, not by the table name string) to avoid pure-cosmetic churn.
--
-- sql/045 (erp_product_merge_suggestions) was written but never applied —
-- it is folded directly into this migration as ops_product_merge_suggestions
-- instead.

alter table public.erp_product_master rename to ops_product_master;
alter table public.erp_product_aliases rename to ops_product_aliases;
alter table public.erp_lot_aliases rename to ops_lot_aliases;
alter table public.erp_upload_batches rename to ops_upload_batches;
alter table public.erp_feeding_entries rename to ops_feeding_entries;
alter table public.erp_production_entries rename to ops_production_entries;
alter table public.erp_stock_snapshots rename to ops_stock_snapshots;
alter table public.erp_rm_batch_stock rename to ops_rm_batch_stock;
alter table public.erp_exceptions rename to ops_exceptions;
alter table public.erp_daily_control_summary rename to ops_daily_control_summary;

alter table public.deviation_tickets rename column erp_exception_id to ops_exception_id;

do $$ begin
  alter type public.app_role rename value 'erp_operator' to 'ops_operator';
exception when undefined_object then null; end $$;

-- erp_product_merge_suggestions (sql/045, never applied) — created fresh
-- here under its final ops_ name instead.
create table public.ops_product_merge_suggestions(
  id uuid primary key default gen_random_uuid(),
  keep_product_id uuid not null references public.ops_product_master(id),
  merge_product_id uuid not null references public.ops_product_master(id),
  confidence numeric(5,4),
  status text not null default 'pending' check (status in ('pending','merged','dismissed')),
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique(keep_product_id, merge_product_id)
);
create index ops_product_merge_suggestions_status on public.ops_product_merge_suggestions(status);
alter table public.ops_product_merge_suggestions enable row level security;
create policy ops_product_merge_suggestions_read on public.ops_product_merge_suggestions for select to authenticated using(public.is_management() or public.has_role('ops_operator'));
create policy ops_product_merge_suggestions_write on public.ops_product_merge_suggestions for all to authenticated using(public.is_management() or public.has_role('ops_operator')) with check(public.is_management() or public.has_role('ops_operator'));
