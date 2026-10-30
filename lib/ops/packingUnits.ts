import { supabaseAdmin } from '@/lib/supabase/admin';
import { fetchAllRows } from '@/lib/supabase/fetchAll';

const WEIGHT_UNIT_RE = /\bMT\b/i;

export type PackingUnits = { weight: Set<string>; nonWeight: Set<string> };

/** Per (product, packing name), is that packing weight-denominated (MT) or
 * not (NOS/KGS/Lr/etc)? Confirmed against real production data this is NOT a
 * fixed label rule — "Bulk" is MT for most products but KGS for at least
 * one, and "Plastic"/"P I"/"P II" are genuinely MT for some products (Rice
 * Bran Oil's tank stages) and a bag COUNT for others (DORB's stitched
 * plastic packing). Stock Summary's own packing_size column ("1 MT" vs
 * "1 NOS" vs "1 KGS") is the one place this unit is actually stated, per
 * product+packing — read it from there instead of guessing from the packing
 * name. A packing absent from both sets was simply never seen in Stock
 * Summary yet for that product. */
export async function loadPackingUnits(productIds: string[]): Promise<PackingUnits> {
  const weight = new Set<string>(), nonWeight = new Set<string>();
  if (!productIds.length) return { weight, nonWeight };
  const db = supabaseAdmin();
  // Currently well under the 1000-row cap for a normal product set, but not
  // provably bounded as history grows — page through rather than risk a
  // silently truncated result (see lib/supabase/fetchAll.ts).
  const { data } = await fetchAllRows<any>((rangeFrom, rangeTo) => db.from('ops_stock_snapshots').select('product_id,packing_name,packing_size').in('product_id', productIds).range(rangeFrom, rangeTo));
  for (const r of data || []) {
    const pid = (r as any).product_id, packing = (r as any).packing_name as string | null;
    if (!pid || !packing) continue;
    const key = `${pid}|${packing.trim().toLowerCase()}`;
    (WEIGHT_UNIT_RE.test((r as any).packing_size || '') ? weight : nonWeight).add(key);
  }
  return { weight, nonWeight };
}

export function isWeightPacking(units: PackingUnits, productId: string | null | undefined, packing: string | null | undefined): boolean {
  if (!productId) return /bulk/i.test(packing || '');
  const key = `${productId}|${(packing || '').trim().toLowerCase()}`;
  if (units.weight.has(key)) return true;
  if (units.nonWeight.has(key)) return false;
  // Never seen this exact product+packing combo in Stock Summary yet — fall
  // back to the conservative historical default rather than silently
  // including an unverified packing type.
  return /bulk/i.test(packing || '');
}

export function isWeightPackingName(size: string | null | undefined): boolean {
  return WEIGHT_UNIT_RE.test(size || '');
}
