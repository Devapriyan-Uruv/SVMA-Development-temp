-- V8.6.10: granular View/Edit/Delete module access, plus a Management
-- approval workflow for any change to a user's module access. View = can
-- see that module's pages/data. Edit = can also change things in it
-- (enter data, edit tickets/records). Delete = can also remove/deactivate
-- things in it (users, parameters, records) — consistent across every
-- module, not specific to one.
--
-- Approval model: when Admin/HR Admin/Super Admin changes what a user can
-- do in a module, that user's access to the module is revoked immediately
-- (this migration does not retroactively revoke existing grants — only
-- new changes go through this flow from here on) and a pending request is
-- recorded; the previous (pre-change) values are kept on the request row
-- so a rejection can restore them exactly. Anyone with the existing
-- 'management' role, or 'super_admin', can approve or reject — a Super
-- Admin can also immediately self-approve their own request rather than
-- wait, since they're already in the approver set.

alter table public.user_module_access
  add column if not exists can_edit boolean not null default false,
  add column if not exists can_delete boolean not null default false;

create table if not exists public.module_access_requests(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 module text not null,
 requested_by uuid references public.profiles(id),
 previous_view boolean not null default false,
 previous_edit boolean not null default false,
 previous_delete boolean not null default false,
 requested_view boolean not null default false,
 requested_edit boolean not null default false,
 requested_delete boolean not null default false,
 status text not null default 'pending',
 decided_by uuid references public.profiles(id),
 decided_at timestamptz,
 decision_comment text,
 created_at timestamptz not null default now()
);
create index if not exists idx_module_access_requests_status on public.module_access_requests(status,created_at);
create index if not exists idx_module_access_requests_user on public.module_access_requests(user_id);
