-- Creditors / Debtors — the consolidated voucher store. Every uploaded Day Book is merged into this table by voucher identity
-- (date, type, number, head ledger, first bill reference): a voucher already here is left alone, an edited one is updated, and
-- only new ones are added. The outstanding is always worked out from this whole set, so uploading the same file again, an
-- overlapping file or a single day's file all give the same, consolidated result.

create table if not exists public.outstanding_vouchers(
  vkey text primary key,
  vch_date date not null,
  vch_type text not null,
  vch_no text,
  content_hash text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists outstanding_vouchers_date on public.outstanding_vouchers(vch_date);

alter table public.outstanding_vouchers enable row level security;
create policy outstanding_vouchers_read on public.outstanding_vouchers for select to authenticated using(public.is_management() or public.has_role('finance_user') or public.has_role('finance_manager'));
create policy outstanding_vouchers_write on public.outstanding_vouchers for all to authenticated using(public.is_management() or public.has_role('finance_user') or public.has_role('finance_manager')) with check(public.is_management() or public.has_role('finance_user') or public.has_role('finance_manager'));
