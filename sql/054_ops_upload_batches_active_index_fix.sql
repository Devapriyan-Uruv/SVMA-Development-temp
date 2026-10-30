-- Fixes a real, previously-latent bug confirmed live: the "one active batch
-- per (report_type, report_date)" constraint was accidentally enforced for
-- EVERY report type, not just the 4 genuine snapshot types
-- (stock_snapshot, rm_batch_stock, purchase_order_pending,
-- settlement_pending) that lib/ops/persist.ts's activateSnapshotBatch()
-- actually versions.
--
-- Every other (append-only/transaction-log) report type's batch row
-- defaults to is_active=true and is NEVER explicitly deactivated
-- (activateSnapshotBatch is only ever called when
-- SNAPSHOT_REPORT_TYPES.has(reportType) — see lib/ops/parsers/index.ts).
-- The original comment on this index reasoned about that backwards: "never
-- flip is_active=false... so this never blocks re-uploads" — in fact never
-- deactivating combined with a default-active row is exactly what caused a
-- collision. The SECOND time any non-snapshot type was ever uploaded for a
-- report_date that already had an active batch of that type — completely
-- normal usage (re-uploading Gate In/Out, Production, Purchase Register,
-- Inward QC, Time Office, Sales, Sale Order for the same day) — the
-- finalizing UPDATE crashed with a raw unique-constraint violation instead
-- of completing. Confirmed live: 4 of 16 real files in one batch hit this
-- (Gate Out, Inward QC, Production, Purchase Register LotWise), each
-- leaving its ops_upload_batches row stuck at status='failed' even though
-- its actual data rows had already been persisted successfully.
--
-- Must match SNAPSHOT_REPORT_TYPES in lib/ops/parsers/index.ts exactly if
-- that set ever changes.
begin;
drop index if exists public.erp_upload_batches_one_active_per_date;
create unique index erp_upload_batches_one_active_per_date on public.ops_upload_batches(report_type, report_date)
  where is_active and report_type in ('stock_snapshot','rm_batch_stock','purchase_order_pending','settlement_pending');
commit;
