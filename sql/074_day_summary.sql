-- Day Summary Ledger — every voucher of an uploaded Day Book, kept by date so any day can be summarised and re-checked against the
-- ERP later (the Creditors / Debtors store only keeps vouchers that carry bill references). Uploading a date again replaces that date.

create table if not exists public.daybook_day_vouchers(
  vkey text primary key,
  vch_date date not null,
  vch_type text,
  vch_no text,
  payload jsonb not null,
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid
);
create index if not exists daybook_day_vouchers_date on public.daybook_day_vouchers(vch_date);

alter table public.daybook_day_vouchers enable row level security;
drop policy if exists daybook_day_vouchers_read on public.daybook_day_vouchers;
create policy daybook_day_vouchers_read on public.daybook_day_vouchers for select to authenticated using(public.is_management() or public.has_role('finance_user') or public.has_role('finance_manager'));
drop policy if exists daybook_day_vouchers_write on public.daybook_day_vouchers;
create policy daybook_day_vouchers_write on public.daybook_day_vouchers for all to authenticated using(public.is_management() or public.has_role('finance_user') or public.has_role('finance_manager')) with check(public.is_management() or public.has_role('finance_user') or public.has_role('finance_manager'));
