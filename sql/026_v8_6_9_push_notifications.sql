-- V8.6.9: real Web Push notifications (a system notification that appears
-- and updates the app icon badge even when the app is fully closed), not
-- just the in-app bell. See lib/push.ts, app/api/push/*, public/sw.js.

create table if not exists public.push_subscriptions(
 id bigserial primary key,
 user_id uuid not null references public.profiles(id) on delete cascade,
 endpoint text not null unique,
 p256dh text not null,
 auth text not null,
 created_at timestamptz not null default now()
);
create index if not exists idx_push_subscriptions_user on public.push_subscriptions(user_id);

-- Marks a notification row as already pushed, so the sweep endpoint (the
-- only way to deliver a push for a notification the deviation-alert DB
-- trigger inserted directly in Postgres, bypassing the app's own request
-- handlers entirely) never sends the same one twice.
alter table public.notifications add column if not exists push_sent_at timestamptz;
create index if not exists idx_notifications_unpushed on public.notifications(created_at) where push_sent_at is null;
