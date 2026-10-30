-- V8.6.4: a real internal chat module (direct messages, groups, shared
-- documents, read tracking) and a simple approval-request workflow.
-- Additive only. Supersedes the single-channel chat_messages table from an
-- earlier draft of this migration — safe to run as-is since that draft was
-- never applied.

create table if not exists public.chat_conversations(
 id uuid primary key default gen_random_uuid(),
 type text not null default 'direct', -- 'direct' | 'group'
 name text, -- group display name; null for direct conversations
 created_by uuid references public.profiles(id),
 created_at timestamptz not null default now()
);

create table if not exists public.chat_conversation_members(
 conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 joined_at timestamptz not null default now(),
 last_read_at timestamptz,
 primary key(conversation_id,user_id)
);
create index if not exists idx_chat_members_user on public.chat_conversation_members(user_id);

create table if not exists public.chat_messages(
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
 sender_id uuid references public.profiles(id) on delete set null,
 body text,
 attachment_path text,
 attachment_name text,
 attachment_mime text,
 attachment_size bigint,
 created_at timestamptz not null default now()
);
create index if not exists idx_chat_messages_conversation on public.chat_messages(conversation_id,created_at);

create table if not exists public.approval_requests(
 id uuid primary key default gen_random_uuid(),
 title text not null,
 description text,
 requested_by uuid references public.profiles(id),
 approver_id uuid references public.profiles(id),
 status text not null default 'pending',
 decision_comment text,
 decided_at timestamptz,
 created_at timestamptz not null default now()
);
create index if not exists idx_approval_requests_approver on public.approval_requests(approver_id,status);
create index if not exists idx_approval_requests_requester on public.approval_requests(requested_by,status);
