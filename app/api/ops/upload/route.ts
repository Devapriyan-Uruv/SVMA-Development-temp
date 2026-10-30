import { NextRequest, NextResponse } from 'next/server';
import { moduleAuthorization, OPS_ROLES } from '@/lib/authorize';
import { currentUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { readWorkbook } from '@/lib/reconcile';
import { errorMessage, logServerError } from '@/lib/errors';
import { REPORT_TYPES, parseOpsReport, type ReportType } from '@/lib/ops/parsers/index';
import { processOpsUpload } from '@/lib/ops/persist';
import { reconcileProductionToStock, reconcileRawMaterial } from '@/lib/ops/reconciliation';
import { reconcileQcSettlement } from '@/lib/ops/reconciliationQc';
import { reconcileSales } from '@/lib/ops/reconciliationSales';
import { computeDailyControlSummary } from '@/lib/ops/dailySummary';

export const runtime = 'nodejs';
export const maxDuration = 60;

async function buf(v: FormDataEntryValue | null) { return v instanceof File ? Buffer.from(await v.arrayBuffer()) : null; }

export async function POST(req: NextRequest) {
  try {
    const az = await moduleAuthorization('operations_intelligence', OPS_ROLES);
    if (!az.ok) return NextResponse.json({ error: az.status === 401 ? 'Not authenticated' : 'Operations Intelligence access not assigned' }, { status: az.status });

    const fd = await req.formData();
    const reportType = String(fd.get('reportType') || '') as ReportType;
    if (!REPORT_TYPES.includes(reportType)) return NextResponse.json({ error: 'Unknown ERP report type.' }, { status: 400 });
    const file = fd.get('file');
    const fileBuffer = await buf(file);
    if (!fileBuffer || !(file instanceof File)) return NextResponse.json({ error: 'A file is required.' }, { status: 400 });

    let parsed;
    try { parsed = parseOpsReport(reportType, readWorkbook(fileBuffer)); }
    catch (e) { return NextResponse.json({ error: errorMessage(e, `Could not read this ${reportType} file.`) }, { status: 400 }); }

    const user = await currentUser();
    const result = await processOpsUpload(reportType, file.name, fileBuffer, parsed, user?.id || null);
    if (result.status === 'duplicate_file') return NextResponse.json(result, { status: 200 });

    // Reconciliation needs BOTH sides of a comparison for the same date —
    // running it against a missing counterpart (e.g. Production uploaded,
    // Stock Summary not yet) would flag every product as a 100% variance.
    // Only run once both sources are present for this report_date.
    const db = supabaseAdmin();
    let reconciliation: { productionStock?: { exceptionsCreated: number; ticketsCreated: number }; rawMaterial?: { exceptionsCreated: number; ticketsCreated: number }; qcSettlement?: { exceptionsCreated: number; ticketsCreated: number }; sales?: { exceptionsCreated: number; ticketsCreated: number } } = {};
    if (reportType === 'production' || reportType === 'stock_snapshot') {
      const [{ count: prodCount }, { data: stockBatch }] = await Promise.all([
        db.from('ops_production_entries').select('id', { count: 'exact', head: true }).eq('report_date', result.reportDate),
        db.from('ops_upload_batches').select('id').eq('report_type', 'stock_snapshot').eq('report_date', result.reportDate).eq('is_active', true).maybeSingle(),
      ]);
      if ((prodCount || 0) > 0 && stockBatch) reconciliation.productionStock = await reconcileProductionToStock(result.reportDate!);
    }
    if (reportType === 'feeding' || reportType === 'rm_batch_stock') {
      const [{ count: feedCount }, { data: rmBatch }] = await Promise.all([
        db.from('ops_feeding_entries').select('id', { count: 'exact', head: true }).eq('report_date', result.reportDate),
        db.from('ops_upload_batches').select('id').eq('report_type', 'rm_batch_stock').eq('report_date', result.reportDate).eq('is_active', true).maybeSingle(),
      ]);
      if ((feedCount || 0) > 0 && rmBatch) reconciliation.rawMaterial = await reconcileRawMaterial(result.reportDate!);
    }
    if (reportType === 'inward_qc' || reportType === 'settlement_pending') {
      const [{ count: qcCount }, { count: settleCount }] = await Promise.all([
        db.from('ops_qc_results').select('id', { count: 'exact', head: true }).eq('report_date', result.reportDate),
        db.from('ops_settlements').select('id', { count: 'exact', head: true }).eq('inward_date', result.reportDate),
      ]);
      if ((qcCount || 0) > 0 && (settleCount || 0) > 0) reconciliation.qcSettlement = await reconcileQcSettlement(result.reportDate!);
    }
    if (reportType === 'sale_order_details' || reportType === 'sales_register') {
      const [{ count: soCount }, { count: invCount }] = await Promise.all([
        db.from('ops_sales_orders').select('id', { count: 'exact', head: true }).eq('so_date', result.reportDate),
        db.from('ops_sales_invoices').select('id', { count: 'exact', head: true }).eq('invoice_date', result.reportDate),
      ]);
      if ((soCount || 0) > 0 && (invCount || 0) > 0) reconciliation.sales = await reconcileSales(result.reportDate!);
    }
    // Feeding/Production files routinely carry MANY dates in one upload
    // (confirmed live: a single Production Report spanned 18 days) —
    // result.reportDate is only the file's first row, so recomputing just
    // that one date silently left every later date's Control Tower summary
    // stale/missing even though its production/feeding data was already in.
    // Recompute per distinct date actually in the file for these two types;
    // every other report type is one date per batch, so the single
    // result.reportDate stays correct there.
    // Best-effort: the Control Tower summary is a read-side convenience,
    // never something that should fail an otherwise-successful upload.
    try {
      if (reportType === 'feeding' || reportType === 'production') {
        const dates = [...new Set(parsed.rows.map((r: any) => r.reportDate).filter(Boolean))];
        for (const d of dates) await computeDailyControlSummary(d);
      } else if (result.reportDate) await computeDailyControlSummary(result.reportDate);
    } catch (e) { logServerError('ops/upload:computeDailyControlSummary', e); }

    return NextResponse.json({ ...result, reconciliation });
  } catch (e) {
    logServerError('erp/upload', e);
    return NextResponse.json({ error: errorMessage(e, 'ERP upload failed.') }, { status: 500 });
  }
}
