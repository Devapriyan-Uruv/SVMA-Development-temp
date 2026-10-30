-- V8.6.7: reminders delivered through chat. A reminder is scheduled against
-- a conversation and, once due, is posted into that conversation as a
-- message (so it's visible in the normal thread) plus a notification per
-- member — delivered by a client-triggered sweep (app/api/chat/reminders/sweep),
-- the same polling pattern already used for Quality's sample/result SLA
-- sweep, since this app has no separate background worker.

create table if not exists public.chat_reminders(
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
 created_by uuid references public.profiles(id) on delete set null,
 message text not null,
 remind_at timestamptz not null,
 delivered_at timestamptz,
 created_at timestamptz not null default now()
);
create index if not exists idx_chat_reminders_due on public.chat_reminders(remind_at) where delivered_at is null;
create index if not exists idx_chat_reminders_conversation on public.chat_reminders(conversation_id,remind_at);
