-- V8.6.11: Keka-style HR self-service — personal details, education
-- history, document uploads, asset issuance/return, and performance
-- reviews. Additive only. Personal-detail fields go straight onto
-- profiles (already the single source of truth for every employee, used
-- across the whole app) rather than a new table, so every existing read
-- of profiles picks them up with no join. Employee self-entry saves
-- directly — no separate approval step, matching how profile edits and
-- leave requests already work in this app.

alter table public.profiles
  add column if not exists date_of_birth date,
  add column if not exists gender text,
  add column if not exists marital_status text,
  add column if not exists blood_group text,
  add column if not exists personal_email text,
  add column if not exists alternate_phone text,
  add column if not exists current_address text,
  add column if not exists permanent_address text,
  add column if not exists emergency_contact_name text,
  add column if not exists emergency_contact_phone text,
  add column if not exists emergency_contact_relation text,
  add column if not exists bank_account_name text,
  add column if not exists bank_account_number text,
  add column if not exists bank_ifsc text,
  add column if not exists bank_name text,
  add column if not exists pan_number text,
  add column if not exists aadhaar_number text,
  add column if not exists date_of_joining date;

-- One-to-many: 10th, 12th, Bachelor's, Master's, certifications, etc.
create table if not exists public.employee_education(
 id bigserial primary key,
 profile_id uuid not null references public.profiles(id) on delete cascade,
 level text not null,
 institution text,
 field_of_study text,
 start_year int,
 end_year int,
 grade text,
 created_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists idx_employee_education_profile on public.employee_education(profile_id);

-- Structured categories (so HR can see what's missing at a glance) plus an
-- 'other' catch-all with a free label — covers both the predefined
-- checklist and free-form cases in one shape. document_path is a
-- private-bucket key in the existing svma-hr-documents bucket (same
-- bucket employee_insurance already uses), signed on read, never public.
create table if not exists public.employee_documents(
 id bigserial primary key,
 profile_id uuid not null references public.profiles(id) on delete cascade,
 category text not null default 'other',
 label text,
 document_path text not null,
 file_name text,
 uploaded_by uuid references public.profiles(id),
 uploaded_at timestamptz not null default now()
);
create index if not exists idx_employee_documents_profile on public.employee_documents(profile_id);

-- Company property issued to an employee. return_date null = still with
-- them. HR-managed (issue/return); the employee can view their own.
create table if not exists public.employee_assets(
 id bigserial primary key,
 profile_id uuid not null references public.profiles(id) on delete cascade,
 asset_type text not null,
 asset_name text not null,
 serial_number text,
 condition_notes text,
 issued_date date not null default current_date,
 return_date date,
 issued_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists idx_employee_assets_profile on public.employee_assets(profile_id);

-- Goals kept as a jsonb array ({title, status, note}) rather than a child
-- table — a review's goal list is edited as a whole alongside the review,
-- never queried independently across employees, so a separate table would
-- only add joins with no real benefit here.
create table if not exists public.performance_reviews(
 id uuid primary key default gen_random_uuid(),
 profile_id uuid not null references public.profiles(id) on delete cascade,
 reviewer_id uuid references public.profiles(id),
 period_label text not null,
 period_start date,
 period_end date,
 goals jsonb not null default '[]'::jsonb,
 self_assessment text,
 reviewer_assessment text,
 rating text,
 status text not null default 'draft',
 submitted_at timestamptz,
 reviewed_at timestamptz,
 created_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists idx_performance_reviews_profile on public.performance_reviews(profile_id,created_at desc);
create index if not exists idx_performance_reviews_reviewer on public.performance_reviews(reviewer_id,status);
