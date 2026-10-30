import { supabaseAdmin } from '@/lib/supabase/admin';
import { resolveApprovedLotMap, suggestLotAliases } from './lotMatch';
import { writeExceptions, type NewException } from './exceptions';
import { loadPackingUnits, isWeightPacking, isWeightPackingName } from './packingUnits';

// Confirmed tolerance (user Q&A): a variance flags an exception when it
// exceeds 0.5 MT OR 2%, whichever triggers first.
export const TOLERANCE_MT = 0.5;
export const TOLERANCE_PCT = 2;

function exceeds(variance: number, base: number): boolean {
  const pct = base ? Math.abs(variance) / Math.abs(base) * 100 : (variance ? 100 : 0);
  return Math.abs(variance) > TOLERANCE_MT || pct > TOLERANCE_PCT;
}

export type ProductionStockRow = {
  productId: string; productName: string; reportDate: string;
  productionQty: number; stockInwardQty: number; variance: number; variancePct: number | null; status: 'matched' | 'deviation';
};

/** Production -> Stock, per product per day, restricted to packings that are
 * genuinely weight-denominated (MT) on BOTH sides — see loadPackingUnits.
 * Count-denominated packings (bag/NOS packing material) are informational
 * only in Phase 1, not numerically reconciled here, since a bag count and an
 * MT quantity can never be meaningfully summed. Pure/read-only — safe to
 * call from a GET dashboard route as often as needed; see
 * reconcileProductionToStock for the write (exception-creating) variant used
 * only by the upload pipeline. */
export async function computeProductionStockRows(reportDate: string): Promise<ProductionStockRow[]> {
  const db = supabaseAdmin();
  const [{ data: productionRows }, { data: batch }] = await Promise.all([
    db.from('ops_production_entries').select('product_id,packing,quantity').eq('report_date', reportDate),
    db.from('ops_upload_batches').select('id').eq('report_type', 'stock_snapshot').eq('report_date', reportDate).eq('is_active', true).maybeSingle(),
  ]);
  const productIds = [...new Set((productionRows || []).map((r: any) => r.product_id).filter(Boolean))];
  const units = await loadPackingUnits(productIds);
  const productionByProduct = new Map<string, number>();
  for (const r of productionRows || []) { const pid = (r as any).product_id; if (!pid || !isWeightPacking(units, pid, (r as any).packing)) continue; productionByProduct.set(pid, (productionByProduct.get(pid) || 0) + Number((r as any).quantity || 0)); }

  const stockByProduct = new Map<string, number>();
  if (batch) {
    const { data: stockRows } = await db.from('ops_stock_snapshots').select('product_id,inward_qty,packing_size').eq('upload_batch_id', (batch as any).id);
    for (const r of stockRows || []) { const pid = (r as any).product_id; if (!pid || !isWeightPackingName((r as any).packing_size)) continue; stockByProduct.set(pid, (stockByProduct.get(pid) || 0) + Number((r as any).inward_qty || 0)); }
  }

  // Only products the plant actually PRODUCED that day belong in this
  // comparison — confirmed live against real data that a Raw Material
  // (BrokenRice) with an approved stock-side alias but no production-side
  // alias was otherwise pulled in purely because it had stock inward
  // (driven by purchase receipts, not production), producing a nonsense
  // "0 produced vs 13.633 MT inward" false-positive deviation. Stock-only
  // products (raw materials, consumables, packing material bought in) never
  // belong here; Raw Material reconciliation (below) is where feeding/stock
  // movement for those is actually reconciled.
  const allProductIds = new Set(productionByProduct.keys());
  if (!allProductIds.size) return [];
  const { data: products } = await db.from('ops_product_master').select('id,display_name').in('id', [...allProductIds]);
  const nameById = new Map((products || []).map((p: any) => [p.id, p.display_name]));

  const rows: ProductionStockRow[] = [];
  for (const productId of allProductIds) {
    const productionQty = productionByProduct.get(productId) || 0;
    const stockInwardQty = stockByProduct.get(productId) || 0;
    const variance = stockInwardQty - productionQty;
    const variancePct = productionQty ? (variance / productionQty) * 100 : null;
    rows.push({ productId, productName: nameById.get(productId) || productId, reportDate, productionQty, stockInwardQty, variance, variancePct, status: exceeds(variance, productionQty) ? 'deviation' : 'matched' });
  }
  return rows.sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));
}

/** Write path — computes the same rows as computeProductionStockRows and
 * additionally persists ops_exceptions (+ auto-tickets) for deviations. Call
 * exactly once per upload (lib/ops/persist.ts pipeline), never from a GET
 * route, or the same variance would be re-logged as a fresh exception every
 * time someone opens the dashboard. */
export async function reconcileProductionToStock(reportDate: string): Promise<{ rows: ProductionStockRow[]; exceptionsCreated: number; ticketsCreated: number }> {
  const rows = await computeProductionStockRows(reportDate);
  const exceptions: NewException[] = rows.filter(r => r.status === 'deviation').map(r => ({
    exceptionType: 'production_stock_variance', severity: Math.abs(r.variance) > TOLERANCE_MT * 4 ? 'critical' : 'warning',
    reportDate, productId: r.productId, module: 'ops_production', referenceIds: { productionQty: r.productionQty, stockInwardQty: r.stockInwardQty },
    expectedValue: r.productionQty, actualValue: r.stockInwardQty, variance: r.variance, variancePct: r.variancePct, toleranceUsed: TOLERANCE_MT,
    description: `${r.productName}: Production output ${r.productionQty.toFixed(3)} MT vs Stock inward ${r.stockInwardQty.toFixed(3)} MT on ${reportDate} — a ${r.variance.toFixed(3)} MT (${r.variancePct === null ? 'n/a' : r.variancePct.toFixed(1) + '%'}) variance.`,
  }));
  const { created, ticketsCreated } = await writeExceptions(exceptions);
  return { rows, exceptionsCreated: created, ticketsCreated };
}

export type RmReconciliationRow = {
  lotNo: string; reportDate: string; productId: string | null; productName: string;
  openingQty: number; feedingQty: number; computedClosing: number; erpClosing: number | null;
  variance: number | null; status: 'matched' | 'deviation' | 'unmapped';
};

/** Raw Material reconciliation, per RM lot per day, bridging Feeding's own
 * lot_no to RM Batch Stock's lot_no via the human-approved ops_lot_aliases
 * table (see lib/ops/lotMatch.ts — the two files use different numbering
 * schemes with no deterministic transform between them). Phase 1 has no
 * PO/Gate receipt file yet, so receipt_qty is always 0 here — flagged in the
 * formula rather than silently assumed to be complete (Phase 2 supplies it).
 * Pure/read-only, like computeProductionStockRows above. Lot is still the
 * unit of computation here (it's the only level RM Batch Stock's own closing
 * figure exists at) — see computeRmProductRows below for the product/day
 * rollup that is the primary UI view; this stays available as its
 * per-product drill-down detail. */
export async function computeRmReconciliationRows(reportDate: string): Promise<RmReconciliationRow[]> {
  const db = supabaseAdmin();
  const { data: feedingRows } = await db.from('ops_feeding_entries').select('lot_no,weight_mt,product_id').eq('report_date', reportDate);
  const { data: activeBatch } = await db.from('ops_upload_batches').select('id').eq('report_type', 'rm_batch_stock').eq('report_date', reportDate).eq('is_active', true).maybeSingle();
  const feedingLots = [...new Set((feedingRows || []).map((r: any) => r.lot_no).filter(Boolean))];
  if (!feedingLots.length) return [];

  const lotMap = await resolveApprovedLotMap(feedingLots);
  const feedingByLot = new Map<string, number>();
  const productByLot = new Map<string, string | null>();
  for (const r of feedingRows || []) {
    const lot = (r as any).lot_no; if (!lot) continue;
    feedingByLot.set(lot, (feedingByLot.get(lot) || 0) + Number((r as any).weight_mt || 0));
    if (!productByLot.has(lot)) productByLot.set(lot, (r as any).product_id || null);
  }
  const productIds = [...new Set([...productByLot.values()].filter((id): id is string => !!id))];
  const { data: products } = productIds.length ? await db.from('ops_product_master').select('id,display_name').in('id', productIds) : { data: [] as any[] };
  const nameById = new Map((products || []).map((p: any) => [p.id, p.display_name]));

  const { data: priorBatch } = await db.from('ops_upload_batches').select('id').eq('report_type', 'rm_batch_stock').eq('is_active', true).lt('report_date', reportDate).order('report_date', { ascending: false }).limit(1).maybeSingle();
  const [currentRowsRes, priorRowsRes] = await Promise.all([
    db.from('ops_rm_batch_stock').select('lot_no,weight_mt').eq('upload_batch_id', (activeBatch as any)?.id || '__none__'),
    priorBatch ? db.from('ops_rm_batch_stock').select('lot_no,weight_mt').eq('upload_batch_id', (priorBatch as any).id) : Promise.resolve({ data: [] as any[] }),
  ]);
  const currentByLot = new Map((currentRowsRes.data || []).map((r: any) => [r.lot_no, Number(r.weight_mt || 0)]));
  const priorByLot = new Map((priorRowsRes.data || []).map((r: any) => [r.lot_no, Number(r.weight_mt || 0)]));

  const rows: RmReconciliationRow[] = [];
  for (const feedingLot of feedingLots) {
    const rmLot = lotMap.get(feedingLot);
    const feedingQty = feedingByLot.get(feedingLot) || 0;
    const productId = productByLot.get(feedingLot) || null;
    const productName = productId ? (nameById.get(productId) || productId) : 'Unmapped product';
    if (!rmLot) { rows.push({ lotNo: feedingLot, reportDate, productId, productName, openingQty: 0, feedingQty, computedClosing: 0, erpClosing: null, variance: null, status: 'unmapped' }); continue; }
    const openingQty = priorByLot.get(rmLot) || 0;
    const computedClosing = openingQty - feedingQty; // receipt_qty=0 in Phase 1 (see doc comment)
    const erpClosing = currentByLot.has(rmLot) ? currentByLot.get(rmLot)! : null;
    const variance = erpClosing === null ? null : erpClosing - computedClosing;
    rows.push({ lotNo: feedingLot, reportDate, productId, productName, openingQty, feedingQty, computedClosing, erpClosing, variance, status: variance !== null && exceeds(variance, computedClosing) ? 'deviation' : variance === null ? 'unmapped' : 'matched' });
  }
  return rows;
}

export type RmProductRow = {
  productId: string | null; productName: string; reportDate: string;
  lotCount: number; unmappedLotCount: number;
  openingQty: number; feedingQty: number; computedClosing: number; erpClosing: number | null;
  variance: number | null; status: 'matched' | 'deviation' | 'partial';
};

/** Product/day rollup of computeRmReconciliationRows — the PRIMARY Raw
 * Material view. Raw Material was originally shown lot-wise as the top-level
 * table, which real usage showed is too granular to read at a glance (dozens
 * of lot rows, most "unmapped" until a human approves the lot alias) — a
 * product-per-day figure, matching Production-to-Stock's shape, is what
 * answers "did raw material usage reconcile today" at a glance; lot detail
 * (computeRmReconciliationRows) remains available as a drill-down per
 * product. A product is 'partial' (not 'deviation' or 'matched') if any of
 * its lots are still unmapped — its total can't be trusted yet either way. */
export async function computeRmProductRows(reportDate: string): Promise<RmProductRow[]> {
  const lotRows = await computeRmReconciliationRows(reportDate);
  type Acc = { productId: string | null; productName: string; lotCount: number; unmappedLotCount: number; openingQty: number; feedingQty: number; computedClosing: number; erpClosingSum: number; hasUnknownClosing: boolean };
  const byProduct = new Map<string, Acc>();
  for (const r of lotRows) {
    const key = r.productId || `unmapped:${r.productName}`;
    const cur = byProduct.get(key) || { productId: r.productId, productName: r.productName, lotCount: 0, unmappedLotCount: 0, openingQty: 0, feedingQty: 0, computedClosing: 0, erpClosingSum: 0, hasUnknownClosing: false };
    cur.lotCount++;
    if (r.status === 'unmapped') cur.unmappedLotCount++;
    cur.openingQty += r.openingQty;
    cur.feedingQty += r.feedingQty;
    cur.computedClosing += r.computedClosing;
    if (r.erpClosing === null) cur.hasUnknownClosing = true; else cur.erpClosingSum += r.erpClosing;
    byProduct.set(key, cur);
  }
  const rows: RmProductRow[] = [...byProduct.values()].map(cur => {
    const erpClosing = cur.hasUnknownClosing ? null : cur.erpClosingSum;
    const variance = erpClosing === null ? null : erpClosing - cur.computedClosing;
    const status: RmProductRow['status'] = cur.unmappedLotCount > 0 || variance === null ? 'partial' : exceeds(variance, cur.computedClosing) ? 'deviation' : 'matched';
    return { productId: cur.productId, productName: cur.productName, reportDate, lotCount: cur.lotCount, unmappedLotCount: cur.unmappedLotCount, openingQty: cur.openingQty, feedingQty: cur.feedingQty, computedClosing: cur.computedClosing, erpClosing, variance, status };
  });
  return rows.sort((a, b) => Math.abs(b.variance || 0) - Math.abs(a.variance || 0));
}

/** Write path — same rows as computeRmReconciliationRows, plus AI lot-alias
 * suggestions and persisted ops_exceptions/tickets. Upload pipeline only. */
export async function reconcileRawMaterial(reportDate: string): Promise<{ rows: RmReconciliationRow[]; exceptionsCreated: number; ticketsCreated: number }> {
  const db = supabaseAdmin();
  const { data: feedingRows } = await db.from('ops_feeding_entries').select('lot_no').eq('report_date', reportDate);
  const feedingLots = [...new Set((feedingRows || []).map((r: any) => r.lot_no).filter(Boolean))];
  if (feedingLots.length) {
    const { data: activeBatch } = await db.from('ops_upload_batches').select('id').eq('report_type', 'rm_batch_stock').eq('report_date', reportDate).eq('is_active', true).maybeSingle();
    const { data: allRmLots } = await db.from('ops_rm_batch_stock').select('lot_no').eq('upload_batch_id', (activeBatch as any)?.id || '__none__');
    await suggestLotAliases(feedingLots, (allRmLots || []).map((r: any) => r.lot_no));
  }
  const rows = await computeRmReconciliationRows(reportDate);
  const exceptions: NewException[] = rows.filter(r => r.status === 'deviation' && r.variance !== null).map(r => ({
    exceptionType: 'rm_reconciliation_variance', severity: Math.abs(r.variance!) > TOLERANCE_MT * 4 ? 'critical' : 'warning',
    reportDate, productId: r.productId, module: 'ops_raw_material', referenceIds: { feedingLot: r.lotNo },
    expectedValue: r.computedClosing, actualValue: r.erpClosing, variance: r.variance, toleranceUsed: TOLERANCE_MT,
    description: `Lot ${r.lotNo}: computed closing ${r.computedClosing.toFixed(3)} MT vs ERP-reported closing ${r.erpClosing!.toFixed(3)} MT on ${reportDate} — a ${r.variance!.toFixed(3)} MT variance.`,
  }));
  const { created, ticketsCreated } = await writeExceptions(exceptions);
  return { rows, exceptionsCreated: created, ticketsCreated };
}
