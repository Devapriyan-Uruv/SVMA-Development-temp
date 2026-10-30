-- V8.6.16: HR expansion — goals (set by HR or a reporting manager, tracked
-- by the employee), a central asset registry (Admin/HR register once, then
-- assign/reassign from it — employee_assets becomes the assignment/history
-- table), company-wide documents (readable by everyone, referenced by the
-- chatbot for policy Q&A), leave balances (allocated days HR sets per
-- employee/type/year — used/remaining always computed from leave_requests,
-- never stored, so it can't drift), and a company holiday calendar.
-- Additive only.

-- Goals are a first-class table (not performance_reviews.goals jsonb,
-- which stays as-is/unused going forward) because they need their own
-- lifecycle (status/progress updated by the employee independently of any
-- review cycle) and need to be queried across employees by a manager —
-- both awkward with a jsonb blob embedded in a review row.
create table if not exists public.employee_goals(
 id uuid primary key default gen_random_uuid(),
 profile_id uuid not null references public.profiles(id) on delete cascade,
 title text not null,
 description text,
 target_date date,
 status text not null default 'not_started',
 progress int not null default 0,
 created_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint employee_goals_status_chk check (status in ('not_started','in_progress','completed','missed')),
 constraint employee_goals_progress_chk check (progress between 0 and 100)
);
create index if not exists idx_employee_goals_profile on public.employee_goals(profile_id,created_at desc);

-- Central asset registry: the physical/company asset exists here exactly
-- once, independent of who currently holds it. employee_assets (V8.6.11)
-- stays as the issuance/assignment log — asset_id links an issuance back to
-- its registry row; the free-text asset_type/asset_name/serial_number
-- columns on employee_assets are kept and still populated at assignment
-- time (denormalized snapshot, same continuity pattern already used
-- elsewhere in this schema) so the existing "My Assets" read UI needs no
-- changes, and rows created before this migration (asset_id null) keep
-- working exactly as before.
create table if not exists public.assets(
 id bigserial primary key,
 asset_tag text not null unique,
 name text not null,
 type text not null,
 serial_number text,
 purchase_date date,
 purchase_cost numeric,
 vendor text,
 warranty_expiry date,
 status text not null default 'available',
 notes text,
 created_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint assets_status_chk check (status in ('available','assigned','maintenance','retired'))
);
create index if not exists idx_assets_status on public.assets(status);

alter table public.employee_assets
  add column if not exists asset_id bigint references public.assets(id);
create index if not exists idx_employee_assets_asset on public.employee_assets(asset_id);

-- Company-wide documents (policies, handbook, circulars). `content` is the
-- plain-text the chatbot reads directly (see app/api/assistant);
-- document_path is only for an optional original file (PDF/DOCX) users can
-- download — same private-bucket + signed-URL pattern as svma-hr-documents.
-- Readable by every authenticated user (org-wide policy, unlike the rest of
-- HR data which is role/relationship-scoped); writable by HR/Admin only.
create table if not exists public.company_documents(
 id uuid primary key default gen_random_uuid(),
 title text not null,
 category text,
 content text not null,
 document_path text,
 created_by uuid references public.profiles(id),
 active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists idx_company_documents_active on public.company_documents(active,created_at desc);

insert into storage.buckets(id,name,public)
values('svma-company-documents','svma-company-documents',false)
on conflict(id) do nothing;

-- Allocated leave balance per employee/type/year. used_days is deliberately
-- NOT stored — always summed live from approved leave_requests for that
-- profile/type/year, the same "derive, don't duplicate" choice already
-- made for employee_compensation's insert-only history.
create table if not exists public.leave_balances(
 id bigserial primary key,
 profile_id uuid not null references public.profiles(id) on delete cascade,
 leave_type text not null,
 year int not null,
 allocated_days numeric not null,
 created_by uuid references public.profiles(id),
 updated_at timestamptz not null default now(),
 unique(profile_id,leave_type,year)
);
create index if not exists idx_leave_balances_profile on public.leave_balances(profile_id,year);

-- Company holiday calendar — HR-maintained, visible to everyone.
create table if not exists public.company_holidays(
 id bigserial primary key,
 name text not null,
 holiday_date date not null unique,
 description text,
 created_by uuid references public.profiles(id),
 created_at timestamptz not null default now()
);
create index if not exists idx_company_holidays_date on public.company_holidays(holiday_date);

-- OPTIONAL, run once by hand if existing HR Admin/Admin accounts already
-- have explicit user_module_access rows recorded (they likely do — every
-- account created/edited via Admin > Users gets rows written by
-- requestModuleAccess in app/api/admin/users/route.ts). When explicit rows
-- exist for a user, /api/me uses ONLY those rows, not the role-default
-- fallback — so adding 'assets' to roleDefaults in code will NOT retroactively
-- grant it to already-provisioned accounts. Uncomment and run after
-- deploying the Asset registry commit if existing HR/Admin users don't see
-- the new Assets nav item:
-- insert into public.user_module_access(user_id,module,can_view,can_edit,can_delete)
-- select ur.user_id,'assets',true,true,true
-- from public.user_roles ur
-- where ur.role in ('super_admin','admin','hr_admin')
-- on conflict(user_id,module) do update set can_view=true;
