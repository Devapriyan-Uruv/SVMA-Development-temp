-- V8.6.17: Hand off — transfer an OPEN shift session to another operator
-- instead of closing it. Quality results sometimes arrive after the shift
-- that took the sample has ended (quality_sample_tasks.result_due_at can
-- be well past shift_sessions.scheduled_end); closing the session to end
-- the shift would orphan those pending tasks. Handing off just changes
-- shift_sessions.operator_id — status, active_products, entries and
-- pending sample tasks all carry over untouched, and this table is the
-- permanent "who had it, when" trail. Same shape as shift_session_pauses
-- (V8.6.13) — a shift can be handed off more than once, so history is a
-- child table, not overwritten columns.

create table if not exists public.shift_session_handoffs(
 id bigserial primary key,
 shift_session_id uuid not null references public.shift_sessions(id) on delete cascade,
 from_operator_id uuid references public.profiles(id),
 to_operator_id uuid not null references public.profiles(id),
 reason text,
 handed_off_at timestamptz not null default now()
);
create index if not exists idx_shift_session_handoffs_session on public.shift_session_handoffs(shift_session_id,handed_off_at desc);
