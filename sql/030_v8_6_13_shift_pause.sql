-- V8.6.13: pause/resume a shift session mid-entry, with a required reason
-- and a notification to the scope's Head + Management + Super Admin.
-- shift_sessions.status has always been a free-text column ('active' /
-- 'completed', no enum/check constraint) — 'paused' is just a new value,
-- no type change needed. A child table tracks each pause/resume cycle
-- (a shift can be paused more than once) rather than overwriting a single
-- pair of columns, so the full history and total paused time survive.

create table if not exists public.shift_session_pauses(
 id bigserial primary key,
 shift_session_id uuid not null references public.shift_sessions(id) on delete cascade,
 reason text not null,
 paused_by uuid references public.profiles(id),
 paused_at timestamptz not null default now(),
 resumed_at timestamptz
);
create index if not exists idx_shift_session_pauses_session on public.shift_session_pauses(shift_session_id,paused_at desc);
