-- Per-module AIX3 Insight cache, mirroring ops_management_briefs' shape
-- exactly (report_date-keyed, upserted only on a successful generate call)
-- so each Operations page's insight panel is cheap on repeat loads within
-- the same day instead of calling AIX3 on every page view.
begin;
create table public.ops_page_insights(
  module text not null,
  report_date date not null,
  insight jsonb not null,
  created_at timestamptz not null default now(),
  unique(module, report_date)
);
alter table public.ops_page_insights enable row level security;
create policy ops_page_insights_read on public.ops_page_insights for select to authenticated using(public.is_management() or public.has_role('ops_operator'));
commit;
