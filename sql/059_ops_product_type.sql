-- Finished-goods vs raw-material vs packing-material classification. No such
-- distinction existed on ops_product_master before this — the free-text
-- `category` column (product-group names like "SOYA BARI", "RICE BRAN")
-- stays as-is and unrelated. Backfilled from the real ProductList_AGRO.xlsx
-- (FG/RM/PM sheets, PrdType column) via a one-off script, keyed on
-- product_code which was confirmed to already exact-match this file's
-- ProductCode values from an earlier import this session.
alter table public.ops_product_master
  add column if not exists product_type text check (product_type in ('finished_good','raw_material','packing_material'));
create index if not exists ops_product_master_type on public.ops_product_master(product_type);
