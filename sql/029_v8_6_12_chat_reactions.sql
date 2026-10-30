-- V8.6.12: chat message reactions (emoji/sticker-style). Read receipts and
-- group chat already exist (chat_conversation_members.last_read_at, and
-- chat_conversations.type='group' with the member-add PATCH route) — this
-- migration only adds what was genuinely missing.

create table if not exists public.chat_message_reactions(
 message_id uuid not null references public.chat_messages(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 emoji text not null,
 created_at timestamptz not null default now(),
 primary key(message_id,user_id,emoji)
);
create index if not exists idx_chat_reactions_message on public.chat_message_reactions(message_id);
