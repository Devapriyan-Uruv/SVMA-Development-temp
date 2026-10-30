-- URUV model credits — one row per AI request made by the app, written by the
-- server (service role) at the moment the call returns. Powers the "URUV Model
-- Credits" dashboard and monthly statements (Management and Super Admin only).
--
-- provider_cost_usd = tokens x the provider's per-token rates.
-- billed_usd        = provider_cost_usd x (1 + markup_pct / 100); the markup is
--                     stored on each row so a later change never rewrites history.
-- billed_inr        = billed_usd x usd_inr_rate (the rate in force when the request
--                     was made, also stored on the row). This is the figure shown to
--                     management; amounts exclude GST.
-- Safe to re-run.

create table if not exists public.ai_usage_log(
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  feature text not null default 'general',
  model text not null,
  user_id uuid,
  status text not null default 'ok',
  input_tokens integer not null default 0,
  cached_input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  reasoning_tokens integer not null default 0,
  total_tokens integer not null default 0,
  provider_cost_usd numeric(14,6) not null default 0,
  markup_pct numeric(6,2) not null default 20,
  billed_usd numeric(14,6) not null default 0,
  usd_inr_rate numeric(10,4) not null default 0,
  billed_inr numeric(16,4) not null default 0,
  price_assumed boolean not null default false,
  duration_ms integer
);
alter table public.ai_usage_log add column if not exists usd_inr_rate numeric(10,4) not null default 0;
alter table public.ai_usage_log add column if not exists billed_inr numeric(16,4) not null default 0;
create index if not exists ai_usage_log_created on public.ai_usage_log(created_at desc);
create index if not exists ai_usage_log_feature on public.ai_usage_log(feature, created_at desc);

alter table public.ai_usage_log enable row level security;
drop policy if exists ai_usage_log_read on public.ai_usage_log;
create policy ai_usage_log_read on public.ai_usage_log for select to authenticated
  using(public.has_role('super_admin') or public.has_role('management'));
-- No insert/update/delete policy: only the server (service role) writes usage.
