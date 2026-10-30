-- Fixes a real gap found live-testing the parser against the actual file:
-- Purchase Summary has a THIRD IGST/SGST/CGST group (Payment Details
-- section, sitting immediately before Payable Amount/Paid Amount) that
-- lib/ops/parsers/purchaseSummary.ts never captured — colIndex only ever
-- resolves the FIRST "IGST"/"SGST"/"CGST" column, and nothing anchored the
-- third group until this fix (now read as payable_amount's column minus
-- 3/2/1, confirmed against the real header order). sql/056 shipped without
-- these three columns.
alter table public.ops_purchase_summary
  add column payment_igst numeric(14,2),
  add column payment_sgst numeric(14,2),
  add column payment_cgst numeric(14,2);
