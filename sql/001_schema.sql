-- SVMA Intelligent AI Operations - Supabase schema
-- Run in Supabase SQL Editor or via supabase db push.
create extension if not exists pgcrypto;

create type public.app_role as enum ('super_admin','admin','ceo','management','finance_user','finance_manager','solvent_operator','solvent_head','safety_user','quality_operator','quality_head','viewer');
create type public.entry_status as enum ('due','on_time','late','missing','normal','warning','critical');
create type public.ticket_status as enum ('open','acknowledged','in_progress','waiting','resolved','closed','overdue');
create type public.recon_status as enum ('uploaded','validating','parsing','reconciling','ai_review','generating_report','completed','failed');

create table public.profiles(
 id uuid primary key references auth.users(id) on delete cascade,
 full_name text, email text, phone text, department text, designation text,
 supervisor_id uuid references public.profiles(id), is_active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.user_roles(user_id uuid references public.profiles(id) on delete cascade, role public.app_role not null, primary key(user_id,role));
create table public.user_module_access(user_id uuid references public.profiles(id) on delete cascade, module text not null, can_view boolean not null default true, updated_at timestamptz not null default now(), primary key(user_id,module));
create table public.module_permissions(id bigserial primary key, role public.app_role not null, module text not null, can_view boolean default false, can_create boolean default false, can_edit boolean default false, can_delete boolean default false, can_upload boolean default false, can_reconcile boolean default false, can_review boolean default false, can_approve boolean default false, can_download boolean default false, can_data_entry boolean default false, can_close_ticket boolean default false, unique(role,module));

create table public.shift_master(id bigserial primary key, name text not null unique, start_time time not null, end_time time not null, crosses_midnight boolean not null default false, active boolean not null default true);
create table public.shift_sessions(id uuid primary key default gen_random_uuid(), operational_date date not null, shift_id bigint references public.shift_master(id), operator_id uuid references public.profiles(id), supervisor_id uuid references public.profiles(id), scheduled_start timestamptz, scheduled_end timestamptz, actual_start timestamptz default now(), actual_end timestamptz, status text default 'active', completion_percent numeric(5,2) default 0, late_entries int default 0, missing_entries int default 0, focus_violations int default 0, device_info jsonb default '{}'::jsonb, scope text not null default 'solvent', created_at timestamptz default now());
create table public.shift_focus_events(id bigserial primary key, shift_session_id uuid references public.shift_sessions(id) on delete cascade, event_type text not null, duration_seconds int, client_occurred_at timestamptz, created_at timestamptz default now());

create table public.parameter_sections(id bigserial primary key, module text not null default 'solvent', name text not null, sort_order int default 0, active boolean default true, unique(module,name));
create table public.parameter_master(id bigserial primary key, section_id bigint references public.parameter_sections(id), source_ref text, source_page int, source_serial text, source_group text, source_text text, source_review_required boolean not null default false, name text not null, unit text, description text, target_text text, input_type text not null default 'text', frequency text not null default 'hourly', mandatory boolean default true, alert_enabled boolean default true, ticket_enabled boolean default true, warning_low numeric, warning_high numeric, critical_low numeric, critical_high numeric, options jsonb default '[]'::jsonb, shift_applicability jsonb default '[1,2,3]'::jsonb, time_applicability jsonb default '{}'::jsonb, sort_order int default 0, active boolean default true, created_at timestamptz default now());
create table public.parameter_entries(id uuid primary key default gen_random_uuid(), shift_session_id uuid references public.shift_sessions(id) on delete cascade, parameter_id bigint references public.parameter_master(id), slot_start timestamptz, slot_end timestamptz, due_at timestamptz, value_numeric numeric, value_text text, expected_target text, status public.entry_status default 'due', timeliness_status text, validation_status text, delay_minutes int, comments text, entered_by uuid references public.profiles(id), client_timestamp timestamptz, server_timestamp timestamptz default now(), sync_timestamp timestamptz, unique(shift_session_id,parameter_id,slot_start));
create table public.entry_audit(id bigserial primary key, entry_id uuid references public.parameter_entries(id) on delete cascade, action text not null, old_value jsonb, new_value jsonb, reason text, user_id uuid references public.profiles(id), created_at timestamptz default now());

create table public.deviations(id uuid primary key default gen_random_uuid(), entry_id uuid references public.parameter_entries(id), shift_session_id uuid references public.shift_sessions(id), parameter_id bigint references public.parameter_master(id), severity text not null, target_text text, actual_text text, variance numeric, observed_facts jsonb default '[]'::jsonb, ai_interpretation text, recommended_checks jsonb default '[]'::jsonb, status text default 'open', created_at timestamptz default now(), resolved_at timestamptz);
create table public.deviation_tickets(id uuid primary key default gen_random_uuid(), ticket_no text unique, deviation_id uuid references public.deviations(id), assigned_to uuid references public.profiles(id), solvent_head_id uuid references public.profiles(id), status public.ticket_status default 'open', root_cause text, corrective_action text, closure_comments text, due_at timestamptz, closed_by uuid references public.profiles(id), closed_at timestamptz, created_at timestamptz default now());
create table public.ticket_evidence(id bigserial primary key, ticket_id uuid references public.deviation_tickets(id) on delete cascade, storage_path text not null, file_name text, mime_type text, uploaded_by uuid references public.profiles(id), created_at timestamptz default now());

create table public.notifications(id uuid primary key default gen_random_uuid(), user_id uuid references public.profiles(id), event_type text not null, title text not null, body text, severity text default 'info', entity_type text, entity_id text, read_at timestamptz, push_sent_at timestamptz, created_at timestamptz default now());
create table public.notification_preferences(user_id uuid primary key references public.profiles(id), in_app boolean default true, web_push boolean default true, email boolean default false, whatsapp boolean default false, quiet_hours jsonb default '{}'::jsonb);

create table public.supplier_master(id bigserial primary key, canonical_name text not null unique, category text, active boolean default true);
create table public.supplier_aliases(id bigserial primary key, supplier_id bigint references public.supplier_master(id) on delete cascade, alias text not null unique, approved boolean default true);
create table public.customer_master(id bigserial primary key, canonical_name text not null unique, internal_group boolean default false, active boolean default true);
create table public.customer_aliases(id bigserial primary key, customer_id bigint references public.customer_master(id) on delete cascade, alias text not null unique, approved boolean default true);
create table public.material_master(id bigserial primary key, canonical_name text not null unique, category text not null, active boolean default true);
create table public.material_aliases(id bigserial primary key, material_id bigint references public.material_master(id) on delete cascade, alias text not null unique, approved boolean default true);
create table public.reconciliation_patterns(id bigserial primary key, pattern_type text not null, pattern text not null, category text not null, priority int default 100, active boolean default true);

create table public.uploaded_files(id uuid primary key default gen_random_uuid(), file_type text not null, file_name text not null, storage_path text, sha256 text, file_size bigint, source_date_from date, source_date_to date, row_count int, uploaded_by uuid references public.profiles(id), uploaded_at timestamptz default now());
create table public.source_mappings(id bigserial primary key, source_type text not null, logical_field text not null, sheet_name text, header_name text not null, transform_rule jsonb default '{}'::jsonb, active boolean default true, unique(source_type,logical_field,sheet_name));
create table public.reconciliation_runs(id uuid primary key default gen_random_uuid(), reconciliation_date date not null, operational_from timestamptz, operational_to timestamptz, status public.recon_status default 'uploaded', reconciliation_type text not null default 'transaction', run_by uuid references public.profiles(id), summary jsonb default '{}'::jsonb, ai_summary jsonb default '{}'::jsonb, output_storage_path text, created_at timestamptz default now(), completed_at timestamptz);
create table public.reconciliation_run_files(run_id uuid references public.reconciliation_runs(id) on delete cascade, file_id uuid references public.uploaded_files(id), primary key(run_id,file_id));
create table public.reconciliation_source_rows(id uuid primary key default gen_random_uuid(), run_id uuid references public.reconciliation_runs(id) on delete cascade, source_type text not null, source_row_no int, raw_data jsonb not null, normalized_data jsonb default '{}'::jsonb, created_at timestamptz default now());
create table public.physical_matches(id uuid primary key default gen_random_uuid(), run_id uuid references public.reconciliation_runs(id) on delete cascade, weighment_row_id uuid references public.reconciliation_source_rows(id), gate_row_id uuid references public.reconciliation_source_rows(id), direction text, category text, status text, score numeric(6,5), method text, reason text, created_at timestamptz default now());
create table public.purchase_reconciliation(id uuid primary key default gen_random_uuid(), run_id uuid references public.reconciliation_runs(id) on delete cascade, po_number text, supplier_name text, material_name text, vehicle_no text, gate_pass text, gate_entry_at timestamptz, tally_voucher text, tally_against_ref text, tally_date date, found_in_tally boolean, match_status text, match_method text, ai_assisted boolean default false, confidence numeric(6,5), debit_value numeric, exception text, remarks text, review_status text default 'pending', created_at timestamptz default now());
create table public.sales_reconciliation(id uuid primary key default gen_random_uuid(), run_id uuid references public.reconciliation_runs(id) on delete cascade, so_number text, customer_name text, product_name text, vehicle_no text, gate_pass text, gate_out_at timestamptz, tally_voucher text, tally_against_ref text, tally_date date, found_in_tally boolean, match_status text, match_method text, ai_assisted boolean default false, confidence numeric(6,5), credit_value numeric, exception text, remarks text, review_status text default 'pending', created_at timestamptz default now());
create table public.job_work_reconciliation(id uuid primary key default gen_random_uuid(), run_id uuid references public.reconciliation_runs(id) on delete cascade, job_work_type text not null, reference_no text, party_name text, material_name text, vehicle_no text, movement_date timestamptz, raw_data jsonb, created_at timestamptz default now());
create table public.supply_reconciliation(id uuid primary key default gen_random_uuid(), run_id uuid references public.reconciliation_runs(id) on delete cascade, supply_category text, party_name text, material_name text, vehicle_no text, movement_date timestamptz, raw_data jsonb, created_at timestamptz default now());
create table public.payment_reconciliation(id uuid primary key default gen_random_uuid(), run_id uuid references public.reconciliation_runs(id) on delete cascade, po_number text, vendor_name text, invoice_no text, expected_gross numeric, adjustments numeric, expected_net_payable numeric, tally_payment_voucher text, payment_date date, payment_amount numeric, payment_medium text, amount_difference numeric, payment_status text, ai_assisted boolean default false, confidence numeric(6,5), evidence jsonb, exception text, remarks text, created_at timestamptz default now());
create table public.receipt_reconciliation(id uuid primary key default gen_random_uuid(), run_id uuid references public.reconciliation_runs(id) on delete cascade, so_number text, customer_name text, invoice_no text, expected_amount numeric, received_amount numeric, receipt_date date, receipt_medium text, outstanding_amount numeric, amount_difference numeric, receipt_status text, ai_assisted boolean default false, confidence numeric(6,5), evidence jsonb, exception text, remarks text, created_at timestamptz default now());
create table public.reconciliation_exceptions(id uuid primary key default gen_random_uuid(), run_id uuid references public.reconciliation_runs(id) on delete cascade, exception_type text not null, severity text not null default 'warning', entity_type text, entity_id text, vehicle_no text, party_name text, reference_no text, description text, ai_analysis text, recommended_action text, assigned_to uuid references public.profiles(id), status text default 'open', resolution text, resolved_by uuid references public.profiles(id), resolved_at timestamptz, created_at timestamptz default now());
create table public.ai_match_reviews(id uuid primary key default gen_random_uuid(), run_id uuid references public.reconciliation_runs(id) on delete cascade, source_entity text, source_id text, candidate_data jsonb, ai_decision text, ai_confidence numeric(6,5), ai_reason text, human_decision text, human_reason text, reviewed_by uuid references public.profiles(id), reviewed_at timestamptz, created_at timestamptz default now());
create table public.ai_reports(id uuid primary key default gen_random_uuid(), report_type text not null, operational_date date, shift_session_id uuid references public.shift_sessions(id), reconciliation_run_id uuid references public.reconciliation_runs(id), model text, input_refs jsonb default '[]'::jsonb, report jsonb not null, created_at timestamptz default now());
create table public.audit_logs(id bigserial primary key, user_id uuid references public.profiles(id), module text not null, action text not null, entity_type text, entity_id text, before_data jsonb, after_data jsonb, metadata jsonb default '{}'::jsonb, created_at timestamptz default now());

create index idx_entries_shift_slot on public.parameter_entries(shift_session_id,slot_start);
create index idx_entries_parameter on public.parameter_entries(parameter_id,server_timestamp desc);
create index idx_deviations_shift on public.deviations(shift_session_id,created_at desc);
create index idx_tickets_status on public.deviation_tickets(status,due_at);
create index idx_recon_runs_date on public.reconciliation_runs(reconciliation_date desc);
create index idx_purchase_run_status on public.purchase_reconciliation(run_id,match_status);
create index idx_sales_run_status on public.sales_reconciliation(run_id,match_status);
create index idx_source_rows_run_type on public.reconciliation_source_rows(run_id,source_type);

-- Create profile automatically for new auth users.
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into public.profiles(id,email,full_name) values(new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name',new.email)) on conflict(id) do nothing; return new; end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

-- Role helper used by RLS.
create or replace function public.has_role(required_role public.app_role) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from public.user_roles ur where ur.user_id=auth.uid() and ur.role=required_role)$$;
create or replace function public.is_management() returns boolean language sql stable security definer set search_path=public as $$select public.has_role('super_admin') or public.has_role('admin') or public.has_role('ceo') or public.has_role('management')$$;

-- RLS baseline. Service-role backend can ingest/reconcile; authenticated users are restricted by role.
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.shift_sessions enable row level security;
alter table public.shift_focus_events enable row level security;
alter table public.parameter_master enable row level security;
alter table public.parameter_entries enable row level security;
alter table public.deviations enable row level security;
alter table public.deviation_tickets enable row level security;
alter table public.notifications enable row level security;
alter table public.reconciliation_runs enable row level security;
alter table public.purchase_reconciliation enable row level security;
alter table public.sales_reconciliation enable row level security;
alter table public.payment_reconciliation enable row level security;
alter table public.receipt_reconciliation enable row level security;
alter table public.reconciliation_exceptions enable row level security;
alter table public.audit_logs enable row level security;

create policy profiles_self_or_admin_read on public.profiles for select to authenticated using(id=auth.uid() or public.is_management());
create policy profiles_admin_write on public.profiles for all to authenticated using(public.has_role('super_admin') or public.has_role('admin')) with check(public.has_role('super_admin') or public.has_role('admin'));
create policy roles_admin_all on public.user_roles for all to authenticated using(public.has_role('super_admin') or public.has_role('admin')) with check(public.has_role('super_admin') or public.has_role('admin'));
create policy shifts_operator_or_management on public.shift_sessions for select to authenticated using(operator_id=auth.uid() or supervisor_id=auth.uid() or public.is_management() or public.has_role('solvent_head'));
create policy shifts_operator_insert on public.shift_sessions for insert to authenticated with check(operator_id=auth.uid() or public.has_role('solvent_head') or public.is_management());
create policy focus_operator_insert on public.shift_focus_events for insert to authenticated with check(exists(select 1 from public.shift_sessions s where s.id=shift_session_id and (s.operator_id=auth.uid() or public.has_role('solvent_head') or public.is_management())));
create policy parameters_read on public.parameter_master for select to authenticated using(true);
create policy entries_read on public.parameter_entries for select to authenticated using(public.is_management() or public.has_role('solvent_head') or entered_by=auth.uid());
create policy entries_operator_write on public.parameter_entries for insert to authenticated with check(entered_by=auth.uid() or public.has_role('solvent_head'));
create policy deviations_read on public.deviations for select to authenticated using(public.is_management() or public.has_role('solvent_head') or public.has_role('safety_user'));
create policy tickets_read on public.deviation_tickets for select to authenticated using(public.is_management() or public.has_role('solvent_head') or assigned_to=auth.uid());
create policy notifications_self on public.notifications for select to authenticated using(user_id=auth.uid());
create policy recon_finance_read on public.reconciliation_runs for select to authenticated using(public.is_management() or public.has_role('finance_user') or public.has_role('finance_manager'));
create policy purchase_finance_read on public.purchase_reconciliation for select to authenticated using(public.is_management() or public.has_role('finance_user') or public.has_role('finance_manager'));
create policy sales_finance_read on public.sales_reconciliation for select to authenticated using(public.is_management() or public.has_role('finance_user') or public.has_role('finance_manager'));
create policy payment_finance_read on public.payment_reconciliation for select to authenticated using(public.is_management() or public.has_role('finance_user') or public.has_role('finance_manager'));
create policy receipt_finance_read on public.receipt_reconciliation for select to authenticated using(public.is_management() or public.has_role('finance_user') or public.has_role('finance_manager'));
create policy exception_finance_read on public.reconciliation_exceptions for select to authenticated using(public.is_management() or public.has_role('finance_user') or public.has_role('finance_manager'));
create policy audit_management_read on public.audit_logs for select to authenticated using(public.has_role('super_admin') or public.has_role('admin') or public.has_role('ceo'));

-- Storage buckets (safe to rerun)
insert into storage.buckets(id,name,public) values('svma-source-files','svma-source-files',false) on conflict(id) do nothing;
insert into storage.buckets(id,name,public) values('svma-ticket-evidence','svma-ticket-evidence',false) on conflict(id) do nothing;
insert into storage.buckets(id,name,public) values('svma-reports','svma-reports',false) on conflict(id) do nothing;

create or replace function public.increment_shift_focus_violation(p_shift_session_id uuid) returns void language sql security definer set search_path=public as $$ update public.shift_sessions set focus_violations=coalesce(focus_violations,0)+1 where id=p_shift_session_id; $$;
grant execute on function public.increment_shift_focus_violation(uuid) to authenticated, service_role;

drop policy if exists roles_self_read on public.user_roles;
create policy roles_self_read on public.user_roles for select to authenticated using(user_id=auth.uid());

alter table public.user_module_access enable row level security;
drop policy if exists user_module_access_self_read on public.user_module_access;
create policy user_module_access_self_read on public.user_module_access for select to authenticated using(user_id=auth.uid() or public.has_role('super_admin'));
