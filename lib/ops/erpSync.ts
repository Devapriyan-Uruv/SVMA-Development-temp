import fs from 'node:fs';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { readWorkbook } from '@/lib/reconcile';
import { classifyReport } from '@/lib/aix3/classify';
import { parseOpsReport, type ReportType } from '@/lib/ops/parsers/index';
import { processOpsUpload } from '@/lib/ops/persist';
import { reconcileProductionToStock, reconcileRawMaterial } from '@/lib/ops/reconciliation';
import { reconcileQcSettlement } from '@/lib/ops/reconciliationQc';
import { reconcileSales } from '@/lib/ops/reconciliationSales';
import { computeDailyControlSummary } from '@/lib/ops/dailySummary';
import { generateOperationsBrief } from '@/lib/aix3/brief';
import { withErpSession } from './erpNavigator/browser';
import { executeSteps } from './erpNavigator/executeSteps';
import type { NavigationStep } from './erpNavigator/types';

/** Kicks off a daily ERP push and returns the sync_run_id immediately — the
 * actual work (§ runSync below) runs asynchronously AFTER this function
 * returns. This only works because Render runs a persistent `next start`
 * process (see instrumentation.ts's own background-interval pattern), not
 * a serverless function that gets killed once the HTTP response is sent —
 * do not "simplify" this into an awaited call, the API route needs to
 * respond in milliseconds while this keeps running for minutes. */
export async function runDailyErpPush(reportDate: string, startedBy: string): Promise<string> {
  const db = supabaseAdmin();
  const { count } = await db.from('ops_erp_sync_runs').select('id', { count: 'exact', head: true }).eq('report_date', reportDate);
  const syncCode = `ERP-SYNC-${reportDate.replace(/-/g, '')}-${String((count || 0) + 1).padStart(3, '0')}`;
  const { data: run, error } = await db.from('ops_erp_sync_runs').insert({ sync_code: syncCode, report_date: reportDate, started_by: startedBy, status: 'RUNNING' }).select('id').single();
  if (error || !run) throw new Error('Could not create the ERP sync run record.');
  const syncRunId = (run as any).id as string;

  runSync(syncRunId, reportDate, startedBy).catch(async (e) => {
    await db.from('ops_erp_sync_runs').update({ status: 'FAILED', completed_at: new Date().toISOString(), metadata: { error: e instanceof Error ? e.message : String(e) } }).eq('id', syncRunId);
  });
  return syncRunId;
}

async function updateReportRun(id: string, patch: Record<string, unknown>) {
  await supabaseAdmin().from('ops_erp_sync_report_runs').update(patch).eq('id', id);
}

async function runSync(syncRunId: string, reportDate: string, startedBy: string): Promise<void> {
  const db = supabaseAdmin();
  const { data: catalogRows } = await db.from('ops_erp_report_catalog').select('*').eq('enabled', true).neq('report_code', '__LOGIN__').order('processing_priority');
  const catalog = (catalogRows || []) as any[];
  const catalogIds = catalog.map(c => c.id);
  const { data: navRows } = catalogIds.length ? await db.from('ops_erp_report_navigation').select('*').in('report_catalog_id', catalogIds).eq('active', true) : { data: [] as any[] };
  const navByCatalogId = new Map((navRows || []).map((n: any) => [n.report_catalog_id, n]));

  const counts = { success: 0, duplicate: 0, noData: 0, failed: 0, needReview: 0, newRecords: 0, changedRecords: 0 };

  await withErpSession(async (page, relogin) => {
    let pageIsFresh = true;
    for (const cat of catalog) {
      const nav = navByCatalogId.get(cat.id);
      const { data: srr } = await db.from('ops_erp_sync_report_runs').insert({ sync_run_id: syncRunId, report_catalog_id: cat.id, report_date: reportDate, navigation_id: nav?.id || null, status: 'PENDING', started_at: new Date().toISOString(), expected_report_type: cat.ops_report_type }).select('id').single();
      const srrId = (srr as any)?.id as string;
      if (!srrId) continue;

      if (!nav || nav.status !== 'VERIFIED' || !(nav.navigation_steps as NavigationStep[])?.length) {
        await updateReportRun(srrId, { status: 'NEEDS_NAVIGATION_REVIEW', completed_at: new Date().toISOString(), error_message: 'Navigation not yet verified for this report — configure and test it in ERP Configuration.' });
        counts.needReview++;
        continue;
      }

      // Every report's steps start from the ERP home page, which only a fresh login gives us.
      if (!pageIsFresh) {
        const back = await relogin().catch((e): { success: false; error: string } => ({ success: false, error: e instanceof Error ? e.message : String(e) }));
        if (!back.success) {
          await updateReportRun(srrId, { status: 'FAILED', completed_at: new Date().toISOString(), error_message: `Could not get back to the ERP home page before this report: ${back.error}` });
          counts.failed++;
          continue;
        }
      }
      pageIsFresh = false;

      await updateReportRun(srrId, { status: 'NAVIGATING' });
      let result;
      try {
        result = await executeSteps(page, nav.navigation_steps as NavigationStep[], reportDate, (nav.date_selector_config as any)?.dateFormat);
      } catch (e) {
        result = { success: false, error: e instanceof Error ? e.message : String(e) };
      }

      if (!result.success) {
        await updateReportRun(srrId, { status: 'FAILED', completed_at: new Date().toISOString(), error_message: result.error, retry_count: 0 });
        counts.failed++;
        continue;
      }
      if (!result.downloadedFilePath) {
        await updateReportRun(srrId, { status: 'NO_DATA', completed_at: new Date().toISOString() });
        counts.noData++;
        continue;
      }

      await updateReportRun(srrId, { status: 'DOWNLOADED', download_filename: result.downloadedFileName });
      const fileBuffer = fs.readFileSync(result.downloadedFilePath);

      let book;
      try { book = readWorkbook(fileBuffer); }
      catch { await updateReportRun(srrId, { status: 'FAILED', completed_at: new Date().toISOString(), error_message: 'Downloaded file could not be read as a workbook.' }); counts.failed++; continue; }

      await updateReportRun(srrId, { status: 'VALIDATING' });
      const classification = await classifyReport(result.downloadedFileName || cat.report_name, book);
      await updateReportRun(srrId, { detected_report_type: classification.reportType, classification_confidence: classification.confidence });

      if (cat.has_parser && classification.reportType && classification.reportType !== cat.ops_report_type) {
        await updateReportRun(srrId, { status: 'REPORT_MISMATCH', completed_at: new Date().toISOString(), error_message: `Expected ${cat.ops_report_type}, AIX3 detected ${classification.reportType}.` });
        counts.failed++;
        continue;
      }

      if (!cat.has_parser) {
        // No processor configured yet — file is already durably stored via
        // Storage upload only in the full manual-upload path; without
        // processOpsUpload we have nothing to persist it under, so it's
        // recorded here as validated-only, not silently dropped.
        await updateReportRun(srrId, { status: 'PROCESSED', completed_at: new Date().toISOString(), metadata: { note: 'Downloaded and validated — no processor configured for this report type yet.' } });
        counts.success++;
        continue;
      }

      const reportType = cat.ops_report_type as ReportType;
      let parsed;
      try { parsed = parseOpsReport(reportType, book); }
      catch (e) { await updateReportRun(srrId, { status: 'FAILED', completed_at: new Date().toISOString(), error_message: e instanceof Error ? e.message : String(e) }); counts.failed++; continue; }

      const uploadResult = await processOpsUpload(reportType, result.downloadedFileName || cat.report_name, fileBuffer, parsed, startedBy);
      if (uploadResult.status === 'duplicate_file') {
        await updateReportRun(srrId, { status: 'DUPLICATE_SKIPPED', completed_at: new Date().toISOString() });
        counts.duplicate++;
        continue;
      }

      const finalStatus = uploadResult.newRowCount === 0 ? 'NO_DATA' : uploadResult.versionNo > 1 ? 'NEW_VERSION' : uploadResult.duplicateRowCount > 0 ? 'PARTIALLY_NEW' : 'PROCESSED';
      await updateReportRun(srrId, {
        status: finalStatus, completed_at: new Date().toISOString(), upload_batch_id: uploadResult.batchId,
        rows_read: uploadResult.totalRowsInFile, rows_inserted: uploadResult.newRowCount, rows_skipped: uploadResult.duplicateRowCount, changed_records: uploadResult.correctionFlaggedCount,
      });
      if (finalStatus === 'NO_DATA') counts.noData++; else counts.success++;
      counts.newRecords += uploadResult.newRowCount;
      counts.changedRecords += uploadResult.correctionFlaggedCount;
    }
  });

  // Same "both sides present for this date" reconciliation gating as the
  // manual upload route (app/api/ops/upload/route.ts) — a push of many
  // reports at once still only reconciles pairs that genuinely both have
  // data for reportDate, not just whichever ran this round.
  let exceptionCount = 0, ticketCount = 0;
  const [{ count: prodCount }, { data: stockBatch }, { count: feedCount }, { data: rmBatch }, { count: qcCount }, { count: settleCount }, { count: soCount }, { count: invCount }] = await Promise.all([
    db.from('ops_production_entries').select('id', { count: 'exact', head: true }).eq('report_date', reportDate),
    db.from('ops_upload_batches').select('id').eq('report_type', 'stock_snapshot').eq('report_date', reportDate).eq('is_active', true).maybeSingle(),
    db.from('ops_feeding_entries').select('id', { count: 'exact', head: true }).eq('report_date', reportDate),
    db.from('ops_upload_batches').select('id').eq('report_type', 'rm_batch_stock').eq('report_date', reportDate).eq('is_active', true).maybeSingle(),
    db.from('ops_qc_results').select('id', { count: 'exact', head: true }).eq('report_date', reportDate),
    db.from('ops_settlements').select('id', { count: 'exact', head: true }).eq('inward_date', reportDate),
    db.from('ops_sales_orders').select('id', { count: 'exact', head: true }).eq('so_date', reportDate),
    db.from('ops_sales_invoices').select('id', { count: 'exact', head: true }).eq('invoice_date', reportDate),
  ]);
  if ((prodCount || 0) > 0 && stockBatch) { const r = await reconcileProductionToStock(reportDate); exceptionCount += r.exceptionsCreated; ticketCount += r.ticketsCreated; }
  if ((feedCount || 0) > 0 && rmBatch) { const r = await reconcileRawMaterial(reportDate); exceptionCount += r.exceptionsCreated; ticketCount += r.ticketsCreated; }
  if ((qcCount || 0) > 0 && (settleCount || 0) > 0) { const r = await reconcileQcSettlement(reportDate); exceptionCount += r.exceptionsCreated; ticketCount += r.ticketsCreated; }
  if ((soCount || 0) > 0 && (invCount || 0) > 0) { const r = await reconcileSales(reportDate); exceptionCount += r.exceptionsCreated; ticketCount += r.ticketsCreated; }

  // Best-effort, same as the manual upload route — a summary-write failure
  // must never fail an otherwise-successful ERP push.
  await computeDailyControlSummary(reportDate).catch(() => {});
  await generateOperationsBrief(reportDate).catch(() => {});

  const finalRunStatus = counts.failed > 0 || counts.needReview > 0 ? 'COMPLETED_WITH_EXCEPTIONS' : 'COMPLETED';
  await db.from('ops_erp_sync_runs').update({
    status: finalRunStatus, completed_at: new Date().toISOString(),
    reports_requested: catalog.length, reports_success: counts.success, reports_duplicate: counts.duplicate, reports_no_data: counts.noData, reports_failed: counts.failed, reports_need_review: counts.needReview,
    new_record_count: counts.newRecords, changed_record_count: counts.changedRecords, exception_count: exceptionCount, ticket_count: ticketCount,
  }).eq('id', syncRunId);
}
