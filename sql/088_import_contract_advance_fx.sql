-- Contract-level advance payments and their payment-date FX audit trail.
-- Adds a new table only; does not alter Tally, Day Book, BOE or settlement tables.

create table if not exists public.import_contract_advance_fx (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.import_contracts(id) on delete cascade,
  payment_key text not null,
  payment_date date not null,
  voucher_key text,
  voucher_type text,
  voucher_number text,
  ledger_name text,
  amount_inr numeric(18,2) not null check (amount_inr >= 0),
  inr_per_usd numeric(18,6),
  amount_usd numeric(18,2),
  rate_source text,
  rate_fetched_at timestamptz,
  evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_import_contract_advance_fx unique (contract_id, payment_key)
);

create index if not exists idx_import_contract_advance_fx_contract_date
  on public.import_contract_advance_fx(contract_id, payment_date);

alter table public.import_contract_advance_fx enable row level security;
-- Access is through the authenticated server route using the Supabase service role.
