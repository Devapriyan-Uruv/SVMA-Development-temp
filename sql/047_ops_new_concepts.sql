-- SVMA Operations Intelligence — genuinely new concepts (not renames of
-- existing ERP Intelligence tables): entity timelines, AIX3's daily
-- operations brief, a small classification-cache, and configurable
-- internal product transformations (e.g. Rice Bran Oil's "P I"+"P II"
-- stages combining into one crude-oil movement — never hardcoded, see
-- spec section 21).

create table public.ops_entity_timeline(
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('PO','SO','LOT','VEHICLE','PRODUCT')),
  entity_id text not null,
  event_type text not null,
  event_at timestamptz not null default now(),
  description text not null,
  reference_ids jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index ops_entity_timeline_entity on public.ops_entity_timeline(entity_type, entity_id, event_at);

create table public.ops_management_briefs(
  id uuid primary key default gen_random_uuid(),
  report_date date not null unique,
  period_label text not null default 'daily',
  brief jsonb not null,
  created_at timestamptz not null default now()
);

create table public.ops_aix3_insight_cache(
  id uuid primary key default gen_random_uuid(),
  cache_key text not null unique,
  payload jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index ops_aix3_insight_cache_expires on public.ops_aix3_insight_cache(expires_at);

create table public.ops_product_transformations(
  id uuid primary key default gen_random_uuid(),
  source_product_ids uuid[] not null,
  target_product_id uuid not null references public.ops_product_master(id),
  relationship_type text not null default 'combine',
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.ops_entity_timeline enable row level security;
alter table public.ops_management_briefs enable row level security;
alter table public.ops_aix3_insight_cache enable row level security;
alter table public.ops_product_transformations enable row level security;

create policy ops_entity_timeline_read on public.ops_entity_timeline for select to authenticated using(public.is_management() or public.has_role('ops_operator'));
create policy ops_entity_timeline_write on public.ops_entity_timeline for all to authenticated using(public.is_management() or public.has_role('ops_operator')) with check(public.is_management() or public.has_role('ops_operator'));
create policy ops_management_briefs_read on public.ops_management_briefs for select to authenticated using(public.is_management() or public.has_role('ops_operator'));
create policy ops_management_briefs_write on public.ops_management_briefs for all to authenticated using(public.is_management() or public.has_role('ops_operator')) with check(public.is_management() or public.has_role('ops_operator'));
create policy ops_aix3_insight_cache_read on public.ops_aix3_insight_cache for select to authenticated using(public.is_management() or public.has_role('ops_operator'));
create policy ops_aix3_insight_cache_write on public.ops_aix3_insight_cache for all to authenticated using(public.is_management() or public.has_role('ops_operator')) with check(public.is_management() or public.has_role('ops_operator'));
create policy ops_product_transformations_read on public.ops_product_transformations for select to authenticated using(public.is_management() or public.has_role('ops_operator'));
create policy ops_product_transformations_write on public.ops_product_transformations for all to authenticated using(public.is_management() or public.has_role('ops_operator')) with check(public.is_management() or public.has_role('ops_operator'));
