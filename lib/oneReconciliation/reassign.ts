import { normalizeVehicle } from '@/lib/reconciliation/normalize';
import type { ReceiptRec } from './records';
import type { MasterRow } from './master';
import { JUTE_KG_PER_BAG, PLASTIC_KG_PER_BAG, QTY_TOLERANCE_MT, QTY_TOLERANCE_PCT } from './build';

// Same truck, several loads, one day: a weighment's typed Lot No (or the lot the gate pass resolves to) is sometimes the
// OTHER load's, which leaves both loads with a quantity mismatch — or leaves one with no ERP receipt at all while its own
// receipt sits unlinked. The ERP receipt weight is the weighbridge net less the bags, so a load and "its" receipt agree to a
// few kilograms; when a load is unsettled (mismatch / no receipt) and exactly ONE unclaimed same-vehicle receipt agrees with
// its weight, that receipt's lot is the load's lot. Loads that already agree with their receipt are never touched, and
// anything ambiguous (two receipts fit, or two loads want the same receipt) is left alone for a person to decide.

const up = (s: unknown) => String(s ?? '').trim().toUpperCase();
const dayGap = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;
/** Two receipts within this many kg of equally fitting a load are indistinguishable by weight. */
const AMBIGUOUS_GAP_KG = 20;

export type LotReassignment = { lotNo: string; receipt: ReceiptRec; from: string; gapMt: number; note: string };

/** Smallest |weighbridge net − bags − receipt weight| over the possible bag deductions (none / jute / jute + plastic), in MT. */
function gapMt(netKg: number, rc: ReceiptRec): number {
  if (rc.weight == null) return Infinity;
  const jute = (rc.juteBag ?? 0) * JUTE_KG_PER_BAG, plastic = (rc.plasticBag ?? 0) * PLASTIC_KG_PER_BAG;
  return Math.min(...[0, jute, jute + plastic].map(d => Math.abs((netKg - d) / 1000 - rc.weight!)));
}

export function reassignByWeight(rows: MasterRow[], weighments: { id: string; vehicle: string; weight: number | null; date: string }[], receipts: ReceiptRec[]): Map<string, LotReassignment> {
  const out = new Map<string, LotReassignment>();
  const rcByVehicle = new Map<string, ReceiptRec[]>();
  for (const rc of receipts) { const k = normalizeVehicle(rc.vehicle); if (k && rc.lotNo && rc.weight != null) (rcByVehicle.get(k) || rcByVehicle.set(k, []).get(k)!).push(rc); }
  const byVehicle = new Map<string, number[]>();
  rows.forEach((r, i) => { if (!/purchase/i.test(r.transactionType) && r.transactionType !== 'Purchase') return; const k = normalizeVehicle(weighments[i].vehicle); if (k) (byVehicle.get(k) || byVehicle.set(k, []).get(k)!).push(i); });

  for (const [vehicle, idxs] of byVehicle) {
    const pool = rcByVehicle.get(vehicle);
    if (!pool?.length) continue;
    // A load is settled when it already agrees with the receipt it holds (no QUANTITY MISMATCH and a receipt present).
    const settled = idxs.filter(i => rows[i].v.erpReference !== 'Not Found' && rows[i].v.erpReference !== 'N/A' && !rows[i].statuses.includes('QUANTITY MISMATCH'));
    const unsettled = idxs.filter(i => !settled.includes(i) && (weighments[i].weight ?? 0) > 0 && rows[i].product.matchMethod !== 'not_found' && rows[i].product.masterProductType !== 'packing_material');
    if (!unsettled.length) continue;
    const held = new Set(settled.map(i => up(rows[i].v.erpReference)));
    const free = pool.filter(rc => !held.has(up(rc.rnNo)));
    const fits = new Map<number, { rc: ReceiptRec; gap: number }[]>();
    for (const i of unsettled) {
      const net = weighments[i].weight as number, tol = Math.max(QTY_TOLERANCE_MT, QTY_TOLERANCE_PCT * net / 1000);
      const f = free.filter(rc => dayGap(rc.rnDate, weighments[i].date) <= 1).map(rc => ({ rc, gap: gapMt(net, rc) })).filter(x => x.gap <= tol).sort((a, b) => a.gap - b.gap);
      if (f.length) fits.set(i, f);
    }
    const wanted = new Map<string, number[]>();
    for (const [i, f] of fits) {
      const ambiguous = f.length > 1 && (f[1].gap - f[0].gap) * 1000 < AMBIGUOUS_GAP_KG;
      if (ambiguous) continue;
      (wanted.get(up(f[0].rc.rnNo)) || wanted.set(up(f[0].rc.rnNo), []).get(up(f[0].rc.rnNo))!).push(i);
    }
    for (const [rn, loads] of wanted) {
      if (loads.length !== 1) continue; // two loads want the same receipt
      const i = loads[0], pick = fits.get(i)![0];
      // A receipt already linked to the load's current lot is not a reassignment.
      if (up(rows[i].v.lot) === up(pick.rc.lotNo)) continue;
      const w = weighments[i];
      const from = String(rows[i].v.lot);
      out.set(w.id, {
        lotNo: pick.rc.lotNo, receipt: pick.rc, from, gapMt: Number(pick.gap.toFixed(4)),
        note: `Lot reassigned from ${from === 'Not Found' || from === 'N/A' ? '(none)' : from} to ${pick.rc.lotNo}: ERP receipt ${pick.rc.rnNo} (${pick.rc.weight} MT) is the only unclaimed receipt for vehicle ${w.vehicle} that agrees with this load's weight (${((w.weight as number) / 1000).toFixed(3)} MT less bags); ${from === 'Not Found' || from === 'N/A' ? 'no lot had been linked to it' : 'the lot it was linked to did not agree'}.`,
      });
      void rn;
    }
  }
  return out;
}
