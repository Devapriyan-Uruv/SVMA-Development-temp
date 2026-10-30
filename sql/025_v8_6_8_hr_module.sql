-- V8.6.8: HR module — employees, compensation, insurance, shift rosters and
-- a reporting structure so leave requests route to an employee's own
-- supervisor. Additive only; existing profiles.department (freeform text,
-- already used across the app) is left untouched — department_master is a
-- new, structured concept used for roster scheduling, linked from profiles
-- via the new nullable department_id column.

do $$ begin
  alter type public.app_role add value if not exists 'hr_admin';
exception when duplicate_object then null; end $$;

alter table public.profiles
  add column if not exists department_id bigint;

create table if not exists public.department_master(
 id bigserial primary key,
 name text not null unique,
 active boolean not null default true,
 sort_order int not null default 0,
 created_at timestamptz not null default now()
);

do $$ begin
  alter table public.profiles
    add constraint profiles_department_id_fk foreign key (department_id) references public.department_master(id);
exception when duplicate_object then null; end $$;

insert into public.department_master(name,sort_order) values
 ('Management',1),('Finance',2),('Director',3),('Solvent',4),('Fire Safety',5),
 ('Soybari',6),('Refinery',7),('Quality',8),('Maxibio',9),('General Manager',10),('Accountant',11)
on conflict(name) do nothing;

-- Insert-only history: the latest row per profile by effective_date is the
-- current compensation. Never updated/overwritten, matching how real
-- compensation reviews work and giving a built-in audit trail.
create table if not exists public.employee_compensation(
 id bigserial primary key,
 profile_id uuid not null references public.profiles(id) on delete cascade,
 effective_date date not null,
 base_salary numeric not null,
 currency text not null default 'INR',
 pay_frequency text not null default 'monthly',
 allowances jsonb not null default '[]'::jsonb,
 notes text,
 created_by uuid references public.profiles(id),
 created_at timestamptz not null default now()
);
create index if not exists idx_employee_compensation_profile on public.employee_compensation(profile_id,effective_date desc);

-- One row per policy — an employee can hold several at once (health, life,
-- accident). document_path is a private-bucket storage key (svma-hr-documents),
-- signed on read, never a public URL — same pattern as chat/approval attachments.
create table if not exists public.employee_insurance(
 id bigserial primary key,
 profile_id uuid not null references public.profiles(id) on delete cascade,
 policy_type text not null,
 provider text,
 policy_number text,
 coverage_amount numeric,
 premium numeric,
 start_date date,
 end_date date,
 dependents_covered int not null default 0,
 document_path text,
 notes text,
 created_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists idx_employee_insurance_profile on public.employee_insurance(profile_id);

-- The staffing plan (who is assigned to work which shift, on which date, for
-- which department) — deliberately separate from shift_sessions, which is
-- the live single-operator data-entry session, not a roster.
create table if not exists public.staff_shift_roster(
 id bigserial primary key,
 profile_id uuid not null references public.profiles(id) on delete cascade,
 department_id bigint not null references public.department_master(id),
 shift_id bigint not null references public.shift_master(id),
 roster_date date not null,
 status text not null default 'scheduled',
 notes text,
 created_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 unique(profile_id,roster_date,shift_id)
);
create index if not exists idx_staff_shift_roster_date on public.staff_shift_roster(roster_date,department_id);
create index if not exists idx_staff_shift_roster_profile on public.staff_shift_roster(profile_id,roster_date);

-- approver_id is snapshotted from profiles.supervisor_id at submission time
-- so a later reporting-line change never retroactively alters who decided a
-- past request.
create table if not exists public.leave_requests(
 id uuid primary key default gen_random_uuid(),
 employee_id uuid not null references public.profiles(id) on delete cascade,
 leave_type text not null default 'casual',
 start_date date not null,
 end_date date not null,
 days_count numeric not null,
 reason text,
 approver_id uuid references public.profiles(id),
 status text not null default 'pending',
 decision_comment text,
 decided_at timestamptz,
 created_at timestamptz not null default now()
);
create index if not exists idx_leave_requests_employee on public.leave_requests(employee_id,created_at desc);
create index if not exists idx_leave_requests_approver on public.leave_requests(approver_id,status);

insert into storage.buckets(id,name,public)
values('svma-hr-documents','svma-hr-documents',false)
on conflict(id) do nothing;
