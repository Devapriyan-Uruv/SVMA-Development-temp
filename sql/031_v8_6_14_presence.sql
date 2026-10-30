-- V8.6.14: chat online/offline presence. A single timestamp column,
-- updated as a side effect of the existing /api/me poll (already called
-- by every logged-in user's AppShell every 20s) rather than a dedicated
-- heartbeat endpoint — "online" is just last_seen_at within the last ~45s.

alter table public.profiles add column if not exists last_seen_at timestamptz;
