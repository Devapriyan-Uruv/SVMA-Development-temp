-- Import Master report: the two columns the Import Tracking sheet has that the Import records did not. Safe to re-run; adds columns only.
--   HSN (sheet column 9) belongs to the commodity — filled once, shown on every record of that commodity.
--   BC Principal Paid INR (sheet column 41) belongs to the record.
alter table public.trade_commodities add column if not exists hsn text;
alter table public.import_entries add column if not exists bc_principal_paid_inr numeric;
-- Which import record(s) a contract's settlement sheet reads its Bill of Entry / duty / LC figures from (one record per invoice / shipment).
alter table public.import_contract_invoices add column if not exists import_entry_id uuid references public.import_entries(id) on delete set null;
