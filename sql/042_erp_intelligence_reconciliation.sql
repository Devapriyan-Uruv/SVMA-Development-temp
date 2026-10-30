-- ERP Intelligence Phase 1 — exceptions, ticket integration, and the
-- Management "ERP Daily Control Tower" summary table.
--
-- Ticket integration extends the EXISTING deviation_tickets table instead of
-- a parallel one: deviation_id is already nullable and every current ticket
-- query does an inner join through deviation_id -> deviations -> ... , so a
-- ticket with deviation_id=null and erp_exception_id set is automatically
-- invisible to existing Solvent/Quality ticket screens with zero changes to
-- their queries. The CHECK keeps exactly one origin per ticket.

create table public.erp_exceptions(
  id uuid primary key default gen_random_uuid(),
  exception_type text not null,
  severity text not null default 'warning' check (severity in ('info','warning','critical')),
  report_date date not null,
  product_id uuid references public.erp_product_master(id),
  module text not null,
  reference_ids jsonb not null default '{}'::jsonb,
  expected_value numeric(16,4),
  actual_value numeric(16,4),
  variance numeric(16,4),
  variance_pct numeric(8,4),
  tolerance_used numeric(16,4),
  description text not null,
  ai_narrative text,
  status text not null default 'open' check (status in ('open','acknowledged','resolved','ignored')),
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index erp_exceptions_date on public.erp_exceptions(report_date);
create index erp_exceptions_status on public.erp_exceptions(status, severity);
create index erp_exceptions_product on public.erp_exceptions(product_id, report_date);

alter table public.deviation_tickets add column if not exists module text;
alter table public.deviation_tickets add column if not exists erp_exception_id uuid references public.erp_exceptions(id);
do $$ begin
  alter table public.deviation_tickets add constraint deviation_tickets_origin_check check ((deviation_id is not null) <> (erp_exception_id is not null));
exception when duplicate_object then null; end $$;
create index if not exists erp_exception_tickets on public.deviation_tickets(erp_exception_id) where erp_exception_id is not null;

create table public.erp_daily_control_summary(
  id uuid primary key default gen_random_uuid(),
  report_date date not null unique,
  total_products_active int,
  feeding_total_weight_mt numeric(14,3),
  production_total_qty_mt numeric(14,3),
  stock_closing_value numeric(16,2),
  open_exceptions_count int,
  critical_exceptions_count int,
  open_erp_tickets_count int,
  production_stock_variance_mt numeric(14,3),
  top_variance_products jsonb not null default '[]'::jsonb,
  computed_at timestamptz not null default now()
);

alter table public.erp_exceptions enable row level security;
alter table public.erp_daily_control_summary enable row level security;

create policy erp_exceptions_read on public.erp_exceptions for select to authenticated using(public.is_management() or public.has_role('erp_operator'));
create policy erp_exceptions_write on public.erp_exceptions for all to authenticated using(public.is_management() or public.has_role('erp_operator')) with check(public.is_management() or public.has_role('erp_operator'));
create policy erp_daily_control_summary_read on public.erp_daily_control_summary for select to authenticated using(public.is_management() or public.has_role('erp_operator'));
create policy erp_daily_control_summary_write on public.erp_daily_control_summary for all to authenticated using(public.is_management() or public.has_role('erp_operator')) with check(public.is_management() or public.has_role('erp_operator'));
