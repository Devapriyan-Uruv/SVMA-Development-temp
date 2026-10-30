-- Same class of bug as sql/043, caught by the same live test run against
-- the real ProductionReport.xlsx: "Reference No" is a per-SHIFT identifier,
-- not per-time-slot — the same reference_no ("DORBNG21092026Shift1") repeats
-- across every hourly time_slot within that shift, with the same
-- product+packing appearing again each hour (confirmed real rows: Bulk DORB
-- at 6AM-7AM qty 6.16 and again at 7AM-8AM qty 5.92, both under the same
-- reference_no). sql/041's (reference_no, product_raw, packing) constraint
-- collapsed every hour of the shift into one row and failed outright on the
-- second hour. The true per-row business key needs time_slot too.
alter table public.erp_production_entries drop constraint if exists erp_production_entries_reference_no_product_raw_packing_key;
alter table public.erp_production_entries add constraint erp_production_entries_ref_time_product_packing_key unique (reference_no, time_slot, product_raw, packing);
