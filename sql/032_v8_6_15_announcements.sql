-- V8.6.15: company-wide announcements — Management/Super Admin can publish
-- news or a release note that reaches everyone as a popup on next app
-- open, a bell notification, and a push notification, plus a browsable
-- history everyone can scroll back through.

create table if not exists public.announcements(
 id uuid primary key default gen_random_uuid(),
 title text not null,
 body text not null,
 created_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 active boolean not null default true
);
create index if not exists idx_announcements_active on public.announcements(active,created_at desc);

-- Per-user read tracking, same shape as chat's read receipts — lets the
-- popup show only the newest announcement a given user hasn't seen yet,
-- without ever showing the same one twice.
create table if not exists public.announcement_reads(
 announcement_id uuid not null references public.announcements(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 read_at timestamptz not null default now(),
 primary key(announcement_id,user_id)
);
