-- Run this once if your existing SVMA database is already on V2/V2.1.
create table if not exists public.user_module_access(
  user_id uuid not null references public.profiles(id) on delete cascade,
  module text not null,
  can_view boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key(user_id,module)
);
alter table public.user_module_access enable row level security;
drop policy if exists user_module_access_self_read on public.user_module_access;
create policy user_module_access_self_read on public.user_module_access
for select to authenticated using(user_id=auth.uid() or public.has_role('super_admin'));
create index if not exists idx_user_module_access_user on public.user_module_access(user_id);
