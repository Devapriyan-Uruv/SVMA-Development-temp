import { normalizeVehicle } from '@/lib/reconciliation/normalize';
import type { ReceiptRec } from './records';
import type { LedgerIndex, TallyLedgerVoucher } from './tallyLedger';
import { splitCompositeRef } from './tallyLedger';
import { NOT_FOUND, type MasterRow, type UnlinkedRecord } from './master';
import { JUTE_KG_PER_BAG, PLASTIC_KG_PER_BAG, QTY_TOLERANCE_MT, QTY_TOLERANCE_PCT } from './build';

// The reconciliation is driven by the Weighment Register, so an ERP receipt or a Tally purchase booking that has no weighment
// row never appears anywhere — it just looks as though nothing is missing. This lists them, with the nearest weighments of the
// same vehicle, so Finance can see what is unlinked and why. It never changes a reconciliation status; where a weighment is
// explained by two receipts (one truck, two lots/grades) the weighment's own row gets a note and a data-quality flag.

const up = (s: unknown) => String(s ?? '').trim().toUpperCase();
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const dayGap = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;
const isPurchaseBooking = (v: TallyLedgerVoucher) => /purchase/i.test(v.vchType) && !/order/i.test(v.vchType);

type W = { index: number; reconId: string; date: string; lot: string; party: string; netMt: number | null; erpRef: string; erpQty: number | null; bagKg: number };

export function findUnlinked(rows: MasterRow[], receipts: ReceiptRec[], ledger: LedgerIndex, from: string, to: string): UnlinkedRecord[] {
  const linkedErp = new Set(rows.map(r => up(r.v.erpReference)).filter(k => k && k !== 'NOT FOUND' && k !== 'N/A'));
  const claimedVouchers = new Set(rows.map(r => up(r.v.tallyVoucherNo)).filter(k => k && k !== 'NOT FOUND' && k !== 'N/A'));
  const byVehicle = new Map<string, W[]>();
  rows.forEach((r, index) => {
    if (!/purchase/i.test(r.transactionType)) return;
    const k = normalizeVehicle(String(r.v.vehicle));
    if (!k) return;
    const net = num(r.v.netWeight);
    const w: W = { index, reconId: r.reconId, date: String(r.v.date), lot: String(r.v.lot), party: String(r.v.party), netMt: net == null ? null : net / 1000, erpRef: String(r.v.erpReference), erpQty: num(r.v.erpQuantity), bagKg: num(r.v.bagWeightKg) ?? 0 };
    (byVehicle.get(k) || byVehicle.set(k, []).get(k)!).push(w);
  });

  const out: UnlinkedRecord[] = [];
  const receiptByNo = new Map(receipts.map(r => [up(r.rnNo), r]));
  const claimedByUnlinkedReceipt = new Set<string>();

  for (const rc of receipts) {
    if (!rc.rnNo || linkedErp.has(up(rc.rnNo)) || rc.rnDate < from || rc.rnDate > to) continue;
    const near = (byVehicle.get(normalizeVehicle(rc.vehicle)) || []).filter(w => dayGap(w.date, rc.rnDate) <= 1);
    const bookings = (ledger.byVchNo.get(up(rc.rnNo).replace(/\s+/g, '')) || []).filter(isPurchaseBooking);
    const booked = bookings.length === 1 ? bookings[0] : (ledger.newRefByLot.get(up(rc.lotNo)) || []).map(p => p.voucher).filter(isPurchaseBooking).find((v, i, a) => a.findIndex(x => x.key === v.key) === i) || null;
    if (booked) claimedByUnlinkedReceipt.add(up(booked.vchNo));
    const rcBagKg = (rc.juteBag ?? 0) * JUTE_KG_PER_BAG + (rc.plasticBag ?? 0) * PLASTIC_KG_PER_BAG;

    let reason: string;
    if (!near.length) {
      reason = rc.vehicle ? `No weighment was found for vehicle ${rc.vehicle} within a day of ${rc.rnDate} — the load may be missing from the Weighment Register, or the vehicle number was keyed differently there.` : 'This receipt carries no vehicle number and no weighment could be tied to it.';
    } else {
      // One truck carrying two receipts: the weighbridge net equals the linked receipt plus this one.
      const mixed = near.find(w => w.netMt != null && w.erpQty != null && rc.weight != null && Math.abs(w.netMt - (w.erpQty + rc.weight)) <= Math.max(QTY_TOLERANCE_MT, QTY_TOLERANCE_PCT * w.netMt) + (w.bagKg + rcBagKg) / 1000);
      const sameLot = near.find(w => rc.lotNo && up(w.lot) === up(rc.lotNo));
      if (mixed) {
        reason = `Weighbridge net ${mixed.netMt!.toFixed(3)} MT of ${mixed.reconId} equals its own ERP receipt (${mixed.erpRef}, ${mixed.erpQty} MT) plus this receipt (${rc.weight} MT): one truck carried two lots/grades but only one weighment row exists.`;
        const r = rows[mixed.index];
        r.v.dataQuality = `${r.v.dataQuality === 'OK' ? '' : `${r.v.dataQuality}; `}Truck weight is two receipts (${mixed.erpRef} + ${rc.rnNo}) — one weighment row`;
        r.v.aiComment = `${r.v.aiComment} Weighbridge net equals ERP receipt ${mixed.erpRef} plus ${rc.rnNo} (${rc.lotNo || 'no lot'}), which has no weighment of its own.`.trim();
      } else if (sameLot) reason = `Lot ${rc.lotNo} is on weighment ${sameLot.reconId}, which is linked to ${sameLot.erpRef === NOT_FOUND ? 'no other receipt' : `receipt ${sameLot.erpRef}`} — a second receipt for the same lot.`;
      else reason = `Same-vehicle weighment(s) exist but none matches this receipt's lot or quantity — the weighment may carry a different lot number, or this load was weighed on another day.`;
    }
    out.push({
      source: 'ERP receipt', date: rc.rnDate, reference: rc.rnNo, lot: rc.lotNo || '', party: rc.supplier, vehicle: rc.vehicle, product: rc.product,
      quantityMt: rc.weight, amount: rc.billValue, tallyVoucher: booked ? `${booked.vchNo} (${booked.date}, ₹${booked.amount ?? ''})` : 'Not Found', erpReceipt: rc.rnNo,
      nearestWeighments: near.slice(0, 3).map(w => `${w.reconId} (${w.date}, lot ${w.lot}, ${w.netMt?.toFixed(3) ?? '?'} MT)`).join(' | '), reason,
    });
  }

  // Tally purchase bookings that neither a weighment row nor an unlinked ERP receipt above already accounts for.
  const seen = new Set<string>();
  for (const v of ledger.byKey.values()) {
    if (!isPurchaseBooking(v) || v.date < from || v.date > to) continue;
    const no = up(v.vchNo);
    if (!no || seen.has(no) || claimedVouchers.has(no) || claimedByUnlinkedReceipt.has(no)) continue;
    const lots = [...new Set(v.refs.filter(r => /new ref/i.test(r.kind)).map(r => splitCompositeRef(r.ref)?.lot).filter((x): x is string => !!x))];
    // Only goods bookings (they carry a lot, or their number is an ERP receipt) — freight/service/"Purchase - Other" vouchers have no weighment by nature.
    const rc = receiptByNo.get(no.replace(/\s+/g, '')) || receiptByNo.get(no);
    if (!lots.length && !rc) continue;
    seen.add(no);
    out.push({
      source: 'Tally booking', date: v.date, reference: v.vchNo, lot: lots.join(', '), party: v.party, vehicle: '', product: '',
      quantityMt: null, amount: v.amount, tallyVoucher: `${v.vchNo} (${v.vchType})`, erpReceipt: rc ? rc.rnNo : 'Not Found', nearestWeighments: '',
      reason: rc ? `ERP receipt ${rc.rnNo} exists for this booking but no weighment row is linked to it.` : 'Booked in Tally but no ERP receipt or weighment was found for it in this run.',
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference));
}
