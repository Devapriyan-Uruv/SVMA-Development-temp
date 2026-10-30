import { supabaseAdmin } from '@/lib/supabase/admin';
import { fetchAllRows } from '@/lib/supabase/fetchAll';
import type { OpenBill } from './engine';

// Re-settlement data from the ERP's Credit / Debit Note report. A lot is settled once with one debit or credit note; when the settlement
// is revised the ERP issues another note for the same lot and the first one is replaced. So a lot with more than one distinct note is a
// re-settled lot: the FIRST note is the initial settlement and the LATEST (by date, then upload) is the final one.
//   Settlement value  = the note's net value (what is payable to the supplier after the rebate / deductions).
//   Change in payable = final settlement value − first settlement value  (positive = we pay MORE than first settled).
// A credit note ("CN-...") increases what is payable (it is credit given to the supplier) — that is the extra payment.

export type NoteRec = { ref: string; date: string; kind: 'Credit note' | 'Debit note'; rebate: number; rebateWithGst: number; net: number | null; createdAt: string; advance: number };
export type ResettledLot = {
  lot: string; supplier: string; product: string; notes: NoteRec[]; first: NoteRec; last: NoteRec;
  rebateChange: number; payableChange: number | null;
  /** The supplier's original bill value including GST (the note's bill value plus its own GST) and what each settlement deducted from it. */
  originalBill: number | null; firstDeduction: number | null; finalDeduction: number | null;
  /** Final settlement value − first settlement value: positive = a LOSS (we pay more than first settled, the deduction given back); negative = a gain. */
  loss: number | null;
  /** From the Creditors / Debtors view (Tally Day Book): the party name, the bill and its current settlement value / outstanding. */
  tallyParty?: string; billRef?: string; tallySettlement?: number; outstanding?: number; tallyDifference?: number | null;
};
export type CreditNoteRow = { lot: string; supplier: string; product: string; note: string; date: string; amount: number; resettled: boolean; tallyParty?: string };
export type ResettlementData = {
  lots: ResettledLot[]; creditNotes: CreditNoteRow[];
  summary: { resettledLots: number; suppliers: number; originalBill: number; firstDeduction: number; finalDeduction: number; loss: number; gain: number; netLoss: number; creditNotes: number; creditNoteAmount: number };
  byParty: Record<string, { lots: number; change: number; creditNotes: number; creditNoteAmount: number }>;
};

const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const norm = (s: string) => s.toUpperCase().replace(/\s+/g, '');
const r2 = (n: number) => Math.round(n * 100) / 100;
const seq = (ref: string) => Number(ref.match(/(\d+)(?:\/\d{2}-\d{2})?$/)?.[1] ?? 0);

export async function loadResettlements(bills: OpenBill[] = []): Promise<ResettlementData> {
  const { data, error } = await fetchAllRows<any>((a, b) => supabaseAdmin().from('ops_credit_debit_notes').select('reference_number,date,lot_no,customer_name,product_raw,rebate_value,rebate_net_value,net_value,advance,bill_value,value,total_gst,created_at').order('created_at').range(a, b));
  if (error) throw error;
  // The same note is repeated by every upload that contains it: keep one per reference (the latest copy).
  const byLot = new Map<string, Map<string, { n: NoteRec; supplier: string; product: string; billWithGst: number | null }>>();
  const lotText = new Map<string, string>();
  for (const r of data) {
    const lot = String(r.lot_no || '').trim(); const ref = String(r.reference_number || '').trim();
    if (!lot || !ref) continue;
    const n: NoteRec = { ref, date: String(r.date || '').slice(0, 10), kind: /^CN/i.test(ref) ? 'Credit note' : 'Debit note', rebate: num(r.rebate_value) ?? 0, rebateWithGst: num(r.rebate_net_value) ?? num(r.rebate_value) ?? 0, net: num(r.net_value) == null ? null : (num(r.net_value) as number) + (num(r.advance) ?? 0), advance: num(r.advance) ?? 0, createdAt: String(r.created_at || '') };
    // Original bill (incl. GST) = the note's bill value x (1 + the note's own GST rate); net value is after any advance already paid, so the advance is added back.
    const val = num(r.value), gst = num(r.total_gst), bill = num(r.bill_value);
    const billWithGst = bill == null ? null : r2(bill * (1 + (val && gst != null ? gst / val : 0.05)));
    lotText.set(norm(lot), lot);
    const m = byLot.get(norm(lot)) || byLot.set(norm(lot), new Map()).get(norm(lot))!;
    m.set(ref, { n, supplier: String(r.customer_name || ''), product: String(r.product_raw || ''), billWithGst });
  }
  // Which Tally bill a lot belongs to: the bill reference starts with the lot (RB-G1/100301/26-27/270 -> RB-G1/100301/26-27).
  const creditorBills = bills.filter(b => b.side === 'creditor');
  const billOf = (lot: string) => creditorBills.find(b => norm(b.ref).startsWith(lot + '/') || norm(b.ref) === lot);
  const lots: ResettledLot[] = [], creditNotes: CreditNoteRow[] = [];
  const byParty: ResettlementData['byParty'] = {};
  const party = (name: string) => byParty[name] || (byParty[name] = { lots: 0, change: 0, creditNotes: 0, creditNoteAmount: 0 });
  for (const [lotKey, m] of byLot) {
    const items = [...m.values()].sort((a, b) => a.n.date.localeCompare(b.n.date) || a.n.createdAt.localeCompare(b.n.createdAt) || seq(a.n.ref) - seq(b.n.ref));
    const bill = billOf(lotKey), tallyParty = bill?.party;
    const lotName = lotText.get(lotKey) || lotKey;
    const last = items[items.length - 1];
    for (const it of items) if (it.n.kind === 'Credit note') {
      const resettled = items.length > 1;
      // A credit note that was later replaced is not the current one; only the current note's credit is extra payable.
      if (it !== last) continue;
      creditNotes.push({ lot: lotName, supplier: it.supplier, product: it.product, note: it.n.ref, date: it.n.date, amount: r2(it.n.rebateWithGst), resettled, tallyParty });
      if (tallyParty) { const p = party(tallyParty); p.creditNotes++; p.creditNoteAmount = r2(p.creditNoteAmount + it.n.rebateWithGst); }
    }
    if (items.length < 2) continue;
    const first = items[0];
    const payableChange = first.n.net != null && last.n.net != null ? r2(last.n.net - first.n.net) : null;
    const originalBill = last.billWithGst ?? first.billWithGst;
    const ded = (n: number | null) => (originalBill != null && n != null ? r2(originalBill - n) : null);
    const lot: ResettledLot = { lot: lotName, supplier: last.supplier, product: last.product, notes: items.map(i => i.n), first: first.n, last: last.n, rebateChange: r2(last.n.rebate - first.n.rebate), payableChange, originalBill, firstDeduction: ded(first.n.net), finalDeduction: ded(last.n.net), loss: payableChange, tallyParty };
    if (bill) { lot.billRef = bill.ref; lot.tallySettlement = bill.settlementValue; lot.outstanding = bill.outstanding; lot.tallyDifference = bill.settlementValue != null && last.n.net != null ? r2(last.n.net - bill.settlementValue) : null; }
    lots.push(lot);
    if (tallyParty) { const p = party(tallyParty); p.lots++; p.change = r2(p.change + (payableChange ?? 0)); }
  }
  lots.sort((a, b) => b.last.date.localeCompare(a.last.date) || a.lot.localeCompare(b.lot));
  creditNotes.sort((a, b) => b.date.localeCompare(a.date) || a.lot.localeCompare(b.lot));
  const loss = lots.reduce((s, l) => s + Math.max(0, l.loss ?? 0), 0), gain = lots.reduce((s, l) => s + Math.min(0, l.loss ?? 0), 0);
  const sumOf = (k: 'originalBill' | 'firstDeduction' | 'finalDeduction') => r2(lots.reduce((s, l) => s + (l[k] ?? 0), 0));
  return {
    lots, creditNotes, byParty,
    summary: { resettledLots: lots.length, suppliers: new Set(lots.map(l => l.tallyParty || l.supplier)).size, originalBill: sumOf('originalBill'), firstDeduction: sumOf('firstDeduction'), finalDeduction: sumOf('finalDeduction'), loss: r2(loss), gain: r2(gain), netLoss: r2(loss + gain), creditNotes: creditNotes.length, creditNoteAmount: r2(creditNotes.reduce((s, c) => s + c.amount, 0)) },
  };
}
