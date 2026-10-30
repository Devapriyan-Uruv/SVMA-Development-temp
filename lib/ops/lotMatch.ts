import { supabaseAdmin } from '@/lib/supabase/admin';
import { sequenceRatio } from '@/lib/reconciliation/normalize';

/** Feeding Details and RawMaterialBatchWiseStock sometimes use identical lot
 * numbers and sometimes genuinely different numbering schemes for the same
 * lot (confirmed against real data — most rice-bran lots match exactly,
 * broken-rice lots don't) with no reliable transform between the two
 * schemes. An EXACT string match is unambiguous — auto-approved immediately
 * by suggestLotAliases below, no human step. A fuzzy (partial/reordered)
 * match is genuinely a guess, so it stays 'pending' for a human to confirm
 * before Raw Material reconciliation will use it; getting a lot mapping
 * wrong silently attributes one lot's feeding to another lot's stock, which
 * is a real risk this system shouldn't take on its own. This function
 * returns the APPROVED mapping only. */
export async function resolveApprovedLotMap(feedingLotNos: string[]): Promise<Map<string, string>> {
  const db = supabaseAdmin();
  const unique = [...new Set(feedingLotNos.map(t => t.trim()).filter(Boolean))];
  const map = new Map<string, string>();
  if (!unique.length) return map;
  const { data } = await db.from('ops_lot_aliases').select('feeding_lot_no,rm_batch_lot_no').in('feeding_lot_no', unique).eq('status', 'approved');
  for (const r of data || []) map.set((r as any).feeding_lot_no, (r as any).rm_batch_lot_no);
  return map;
}

export async function suggestLotAliases(feedingLotNos: string[], rmLotNos: string[]): Promise<void> {
  const db = supabaseAdmin();
  const feeding = [...new Set(feedingLotNos.map(t => t.trim()).filter(Boolean))];
  const rm = new Set([...new Set(rmLotNos.map(t => t.trim()).filter(Boolean))]);
  if (!feeding.length || !rm.size) return;
  const { data: existing } = await db.from('ops_lot_aliases').select('feeding_lot_no');
  const already = new Set((existing || []).map((r: any) => r.feeding_lot_no));
  const toInsert: any[] = [];
  for (const f of feeding) {
    if (already.has(f)) continue;
    if (rm.has(f)) { toInsert.push({ feeding_lot_no: f, rm_batch_lot_no: f, status: 'approved', suggested_by: 'ai', confidence: 1, approved_at: new Date().toISOString() }); continue; }
    let best: { lot: string; score: number } | null = null;
    for (const r of rm) { const score = sequenceRatio(f.toUpperCase(), r.toUpperCase()); if (!best || score > best.score) best = { lot: r, score }; }
    if (best && best.score >= 0.35) toInsert.push({ feeding_lot_no: f, rm_batch_lot_no: best.lot, status: 'pending', suggested_by: 'ai', confidence: best.score });
  }
  if (toInsert.length) await db.from('ops_lot_aliases').insert(toInsert);
}
