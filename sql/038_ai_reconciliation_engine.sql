-- AI Transaction Reconciliation Engine: persistent org profile, learned
-- alias/document-family/job-work knowledge stores, manual-correction
-- feedback, and per-transaction traceability. Additive only — the existing
-- reconciliation_runs/reconciliation_exceptions tables (already live) are
-- reused as-is; the dead v1 per-entity tables (purchase_reconciliation etc.)
-- are left untouched.

-- Singleton persistent profile: schema fingerprints per file role, scoring
-- thresholds/weights, and seed taxonomy (bootstrap defaults only — learned
-- knowledge lives in the alias/document-family tables below, not here).
create table if not exists public.svma_reconciliation_profile(
 id text primary key default 'default',
 schema_fingerprints jsonb not null default '{}'::jsonb,
 thresholds jsonb not null default '{}'::jsonb,
 seed_taxonomy jsonb not null default '{}'::jsonb,
 version int not null default 1,
 updated_at timestamptz not null default now(),
 updated_by uuid references public.profiles(id)
);
insert into public.svma_reconciliation_profile(id) values ('default') on conflict(id) do nothing;

create table if not exists public.reconciliation_party_aliases(
 id uuid primary key default gen_random_uuid(),
 canonical_name text not null,
 alias_normalized text not null,
 alias_raw text not null,
 role text,
 confidence numeric(5,4) not null default 0.5,
 verified boolean not null default false,
 sample_count int not null default 1,
 observed_days int not null default 1,
 first_seen date,
 last_seen date,
 source text not null default 'learned',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(alias_normalized,canonical_name)
);

create table if not exists public.reconciliation_material_aliases(
 id uuid primary key default gen_random_uuid(),
 canonical_family text not null,
 alias_normalized text not null,
 alias_raw text not null,
 confidence numeric(5,4) not null default 0.5,
 verified boolean not null default false,
 sample_count int not null default 1,
 observed_days int not null default 1,
 first_seen date,
 last_seen date,
 source text not null default 'learned',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(alias_normalized,canonical_family)
);

-- Document-family discovery: which reference prefix means what, inferred
-- from WHERE it was observed (Gate In PO field, Gate Out SO field, a Tally
-- purchase/sales register), never hardcoded. See lib/reconciliation/documentFamily.ts.
create table if not exists public.reconciliation_document_families(
 id uuid primary key default gen_random_uuid(),
 prefix text not null,
 direction text not null,
 stage text not null,
 confidence numeric(5,4) not null default 0.5,
 evidence jsonb not null default '[]'::jsonb,
 sample_count int not null default 1,
 observed_days int not null default 1,
 first_seen date,
 last_seen date,
 verified boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(prefix,direction,stage)
);

create table if not exists public.reconciliation_job_work_rules(
 id uuid primary key default gen_random_uuid(),
 pattern jsonb not null default '{}'::jsonb,
 confidence numeric(5,4) not null default 0.5,
 verified boolean not null default false,
 evidence jsonb not null default '[]'::jsonb,
 sample_count int not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

-- When a user corrects an AI/deterministic selection, the correction becomes
-- reusable deterministic evidence for future runs (never immediate fine-tuning).
create table if not exists public.reconciliation_manual_feedback(
 id uuid primary key default gen_random_uuid(),
 run_id uuid references public.reconciliation_runs(id) on delete cascade,
 transaction_ref text not null,
 previous_selection jsonb not null default '{}'::jsonb,
 corrected_selection jsonb not null default '{}'::jsonb,
 reason text,
 corrected_by uuid references public.profiles(id),
 created_at timestamptz not null default now()
);

create table if not exists public.reconciliation_schema_adaptations(
 id uuid primary key default gen_random_uuid(),
 file_role text not null,
 detected_change jsonb not null default '{}'::jsonb,
 resolution text not null,
 applied_at timestamptz not null default now()
);

-- One persisted, queryable row per weighment per run — replaces the
-- throw-away JSONB-blob-only history the old transaction engine used.
create table if not exists public.reconciliation_transactions(
 id uuid primary key default gen_random_uuid(),
 run_id uuid not null references public.reconciliation_runs(id) on delete cascade,
 weighment_ref text not null,
 weighment_date date,
 vehicle_raw text,
 vehicle_normalized text,
 party_raw text,
 party_normalized text,
 material_raw text,
 material_normalized text,
 material_family text,
 net_weight numeric,
 category text not null,
 category_reason text,
 gate_selected jsonb,
 gate_candidates jsonb not null default '[]'::jsonb,
 gate_rejected jsonb not null default '[]'::jsonb,
 tally_selected jsonb not null default '[]'::jsonb,
 tally_candidates jsonb not null default '[]'::jsonb,
 tally_rejected jsonb not null default '[]'::jsonb,
 consolidated_with jsonb not null default '[]'::jsonb,
 deterministic_score numeric(6,3),
 ai_confidence numeric(6,3),
 final_confidence numeric(6,3),
 status text not null,
 exception_code text,
 evidence jsonb not null default '[]'::jsonb,
 ai_explanation text,
 source_refs jsonb not null default '{}'::jsonb,
 model_used text,
 profile_version int,
 created_at timestamptz not null default now(),
 unique(run_id,weighment_ref)
);
create index if not exists reconciliation_transactions_run_idx on public.reconciliation_transactions(run_id);
create index if not exists reconciliation_transactions_status_idx on public.reconciliation_transactions(run_id,status);

alter table public.svma_reconciliation_profile enable row level security;
alter table public.reconciliation_party_aliases enable row level security;
alter table public.reconciliation_material_aliases enable row level security;
alter table public.reconciliation_document_families enable row level security;
alter table public.reconciliation_job_work_rules enable row level security;
alter table public.reconciliation_manual_feedback enable row level security;
alter table public.reconciliation_schema_adaptations enable row level security;
alter table public.reconciliation_transactions enable row level security;

drop policy if exists recon_profile_read on public.svma_reconciliation_profile;
create policy recon_profile_read on public.svma_reconciliation_profile for select to authenticated using(true);
drop policy if exists recon_party_aliases_read on public.reconciliation_party_aliases;
create policy recon_party_aliases_read on public.reconciliation_party_aliases for select to authenticated using(true);
drop policy if exists recon_material_aliases_read on public.reconciliation_material_aliases;
create policy recon_material_aliases_read on public.reconciliation_material_aliases for select to authenticated using(true);
drop policy if exists recon_document_families_read on public.reconciliation_document_families;
create policy recon_document_families_read on public.reconciliation_document_families for select to authenticated using(true);
drop policy if exists recon_job_work_rules_read on public.reconciliation_job_work_rules;
create policy recon_job_work_rules_read on public.reconciliation_job_work_rules for select to authenticated using(true);
drop policy if exists recon_manual_feedback_read on public.reconciliation_manual_feedback;
create policy recon_manual_feedback_read on public.reconciliation_manual_feedback for select to authenticated using(public.is_management() or public.has_role('finance_user') or public.has_role('finance_manager'));
drop policy if exists recon_schema_adaptations_read on public.reconciliation_schema_adaptations;
create policy recon_schema_adaptations_read on public.reconciliation_schema_adaptations for select to authenticated using(public.is_management() or public.has_role('finance_user') or public.has_role('finance_manager'));
drop policy if exists recon_transactions_read on public.reconciliation_transactions;
create policy recon_transactions_read on public.reconciliation_transactions for select to authenticated using(public.is_management() or public.has_role('finance_user') or public.has_role('finance_manager'));
