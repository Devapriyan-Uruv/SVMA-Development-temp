import { supabaseAdmin } from '@/lib/supabase/admin';
import { isWeightPackingName } from './packingUnits';
import { fetchAllRows } from '@/lib/supabase/fetchAll';

// Confirmed against the real Sale Order Details.xlsx file: Status is one of
// 'Open' | 'Partially Completed' | 'Completed' | 'Closed' — only the first
// two carry outstanding commitment (quantity not yet dispatched).
const OPEN_SO_STATUSES = new Set(['Open', 'Partially Completed']);

export type AvailabilityRow = {
  productId: string | null; productName: string;
  physicalStockMt: number; openCommitmentMt: number; freeToSellMt: number;
};

/** Free to Sell = latest physical finished-stock closing balance (from the
 * active Stock Summary snapshot, weight-denominated packings only — see
 * packingUnits.ts) minus open Sale Order commitment (quantity not yet
 * dispatched, for orders still Open/Partially Completed). Computed on read,
 * never persisted as if it were its own snapshot fact, and always labeled
 * "Free to Sell" in the UI — never shown as if it were physical stock. */
export async function computeAvailability(): Promise<AvailabilityRow[]> {
  const db = supabaseAdmin();
  const { data: activeBatch } = await db.from('ops_upload_batches').select('id,report_date').eq('report_type', 'stock_snapshot').eq('is_active', true).order('report_date', { ascending: false }).limit(1).maybeSingle();
  const { data: stockRows } = activeBatch ? await db.from('ops_stock_snapshots').select('product_id,closing_qty,packing_size').eq('upload_batch_id', (activeBatch as any).id) : { data: [] as any[] };
  const stockByProduct = new Map<string, number>();
  for (const r of stockRows || []) {
    const pid = (r as any).product_id; if (!pid || !isWeightPackingName((r as any).packing_size)) continue;
    stockByProduct.set(pid, (stockByProduct.get(pid) || 0) + Number((r as any).closing_qty || 0));
  }

  // Under 1000 today (431) but a bare select() over the whole table is the
  // same unbounded shape that already broke elsewhere for other tables —
  // paged pre-emptively rather than waiting for Free to Sell to go wrong
  // silently (see lib/supabase/fetchAll.ts).
  const { data: soRows } = await fetchAllRows<any>((rangeFrom, rangeTo) => db.from('ops_sales_orders').select('product_id,product_raw,quantity,dispatched_qty,status').range(rangeFrom, rangeTo));
  const commitmentByProduct = new Map<string, number>();
  const nameByKey = new Map<string, string>();
  for (const r of soRows || []) {
    if (!OPEN_SO_STATUSES.has((r as any).status)) continue;
    const key = (r as any).product_id || `raw:${(r as any).product_raw}`;
    const remaining = Math.max(0, Number((r as any).quantity || 0) - Number((r as any).dispatched_qty || 0));
    commitmentByProduct.set(key, (commitmentByProduct.get(key) || 0) + remaining);
    if (!nameByKey.has(key)) nameByKey.set(key, (r as any).product_raw);
  }

  const productIds = [...new Set([...stockByProduct.keys(), ...[...commitmentByProduct.keys()].filter(k => !k.startsWith('raw:'))])];
  const { data: products } = productIds.length ? await db.from('ops_product_master').select('id,display_name,product_type').in('id', productIds) : { data: [] as any[] };
  const nameById = new Map((products || []).map((p: any) => [p.id, p.display_name]));
  const typeById = new Map((products || []).map((p: any) => [p.id, p.product_type]));

  // Raw material / packing material can't be sold, so they're excluded from
  // Free to Sell entirely — but an unclassified product (product_type is
  // NULL, e.g. a brand-new SKU auto-created by an upload before anyone's
  // tagged it) stays VISIBLE rather than silently vanishing until someone
  // classifies it; only an explicit non-finished-good type is filtered out.
  const NOT_SELLABLE = new Set(['raw_material', 'packing_material']);
  const allKeys = new Set([...stockByProduct.keys(), ...commitmentByProduct.keys()].filter(key => !NOT_SELLABLE.has(typeById.get(key))));
  const rows: AvailabilityRow[] = [...allKeys].map(key => {
    const isRaw = key.startsWith('raw:');
    const productId = isRaw ? null : key;
    const productName = isRaw ? nameByKey.get(key) || key.slice(4) : (nameById.get(key) || nameByKey.get(key) || key);
    const physicalStockMt = isRaw ? 0 : (stockByProduct.get(key) || 0);
    const openCommitmentMt = commitmentByProduct.get(key) || 0;
    return { productId, productName, physicalStockMt, openCommitmentMt, freeToSellMt: physicalStockMt - openCommitmentMt };
  });
  return rows.sort((a, b) => a.freeToSellMt - b.freeToSellMt);
}
