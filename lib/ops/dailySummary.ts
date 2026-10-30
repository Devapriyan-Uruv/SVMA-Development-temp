import { supabaseAdmin } from '@/lib/supabase/admin';
import { loadPackingUnits, isWeightPacking } from './packingUnits';

/** Recomputed at the end of each upload's pipeline (recompute-on-write) so
 * the Management ERP Daily Control Tower reads one cheap row instead of
 * scanning raw tables live on every dashboard load. */
export async function computeDailyControlSummary(reportDate: string): Promise<void> {
  const db = supabaseAdmin();
  const [{ data: feeding }, { data: productionAll }, { data: activeStockBatch }, { data: exceptions }] = await Promise.all([
    db.from('ops_feeding_entries').select('weight_mt').eq('report_date', reportDate),
    db.from('ops_production_entries').select('quantity,product_id,packing').eq('report_date', reportDate),
    db.from('ops_upload_batches').select('id').eq('report_type', 'stock_snapshot').eq('report_date', reportDate).eq('is_active', true).maybeSingle(),
    db.from('ops_exceptions').select('id,severity,status,product_id,variance,exception_type').eq('report_date', reportDate),
  ]);

  const units = await loadPackingUnits([...new Set((productionAll || []).map((r: any) => r.product_id).filter(Boolean))]);
  const production = (productionAll || []).filter((r: any) => isWeightPacking(units, r.product_id, r.packing));
  const feedingTotal = (feeding || []).reduce((s: number, r: any) => s + Number(r.weight_mt || 0), 0);
  const productionTotal = (production || []).reduce((s: number, r: any) => s + Number(r.quantity || 0), 0);
  const activeProducts = new Set((production || []).map((r: any) => r.product_id).filter(Boolean)).size;

  let stockClosingValue = 0;
  if (activeStockBatch) { const { data: stock } = await db.from('ops_stock_snapshots').select('closing_value').eq('upload_batch_id', (activeStockBatch as any).id); stockClosingValue = (stock || []).reduce((s: number, r: any) => s + Number(r.closing_value || 0), 0); }

  const openExceptions = (exceptions || []).filter((e: any) => e.status === 'open');
  const criticalOpen = openExceptions.filter((e: any) => e.severity === 'critical');
  const prodVariance = (exceptions || []).filter((e: any) => e.exception_type === 'production_stock_variance').reduce((s: number, e: any) => s + Math.abs(Number(e.variance || 0)), 0);
  const topVariance = (exceptions || []).filter((e: any) => e.exception_type === 'production_stock_variance').sort((a: any, b: any) => Math.abs(b.variance) - Math.abs(a.variance)).slice(0, 5).map((e: any) => ({ productId: e.product_id, variance: e.variance }));

  const ticketIds = openExceptions.length ? await db.from('deviation_tickets').select('id').in('ops_exception_id', openExceptions.map((e: any) => e.id)).neq('status', 'closed').neq('status', 'resolved') : { data: [] as any[] };

  // The real column is open_erp_tickets_count (sql/042) — the app's own
  // "ERP" -> "Operations" rename (sql/046) only renamed the table, never
  // this column, so every upsert here was silently failing on every date
  // except the one row that predates the mismatch (PGRST204, "column not
  // found" — swallowed because the write's own error was never checked).
  // Checking it now so a future schema drift fails loudly instead of
  // quietly leaving this whole dashboard section frozen on one stale date.
  const { error } = await db.from('ops_daily_control_summary').upsert({
    report_date: reportDate, total_products_active: activeProducts, feeding_total_weight_mt: feedingTotal, production_total_qty_mt: productionTotal,
    stock_closing_value: stockClosingValue, open_exceptions_count: openExceptions.length, critical_exceptions_count: criticalOpen.length,
    open_erp_tickets_count: (ticketIds.data || []).length, production_stock_variance_mt: prodVariance, top_variance_products: topVariance, computed_at: new Date().toISOString(),
  }, { onConflict: 'report_date' });
  if (error) throw new Error(`Could not save the Operations Daily Control Tower summary for ${reportDate}: ${error.message}`);
}
