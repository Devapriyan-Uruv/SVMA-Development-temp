import * as XLSX from 'xlsx';
import { text, toNumber } from '@/lib/reconciliation/normalize';
import { calendarDate } from '@/lib/reconciliation/parsers';

// Reads the parts of a Tally Day Book that lib/reconciliation/parsers.ts's
// parseTallyUpload deliberately drops: the voucher's own Debit/Credit
// amount, and the "New Ref" / "Agst Ref" bill-reference lines beneath it.
// Real payment vouchers settle against lot+invoice composites
// (e.g. "Agst Ref  RB-G2/091403/26-27/129  178657.00 Dr"), and booking
// vouchers carry the ERP/invoice number as their "New Ref" — both are
// strong deterministic evidence. Used alongside (never instead of) the
// existing parser's booking-stage/register-role classification; vouchers are
// joined by (sheet, row) of the parent line.

export type TallyRef = { kind: string; ref: string; amount: number | null; drcr: string; row: number };
export type TallyLedgerVoucher = {
  key: string; file: string; sheet: string; row: number;
  date: string; party: string; vchType: string; vchNo: string;
  debit: number | null; credit: number | null; amount: number | null; refs: TallyRef[];
  /** The offsetting ledger printed on the line under the voucher (e.g. the supplier credited by a "Water Expenses" journal). */
  counter?: string;
};

const hdr = (v: unknown) => text(v).toLowerCase().replace(/[^a-z0-9]/g, '');
const idx = (row: unknown[], aliases: string[]) => row.findIndex(c => aliases.map(hdr).includes(hdr(c)));
const REF_KINDS = /^(new ref|agst ref|advance|on account)$/i;

export function parseTallyLedger(book: XLSX.WorkBook, file: string): TallyLedgerVoucher[] {
  const out: TallyLedgerVoucher[] = [];
  for (const sheet of book.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[sheet], { header: 1, raw: true, defval: null });
    const hi = rows.slice(0, 60).findIndex(r => idx(r, ['Date']) >= 0 && idx(r, ['Particulars']) >= 0 && idx(r, ['Vch Type', 'Voucher Type']) >= 0);
    if (hi < 0) continue;
    const h = rows[hi];
    const di = idx(h, ['Date']), pi = idx(h, ['Particulars']), ti = idx(h, ['Vch Type', 'Voucher Type']), ni = idx(h, ['Vch No.', 'Voucher No.', 'Vch No']);
    const dri = idx(h, ['Debit Amount', 'Debit']), cri = idx(h, ['Credit Amount', 'Credit']);
    let current: TallyLedgerVoucher | null = null;
    for (let i = hi + 1; i < rows.length; i++) {
      const r = rows[i];
      const date = calendarDate(r[di]), party = text(r[pi]), vchType = text(r[ti]), vchNo = ni >= 0 ? text(r[ni]) : '';
      if (date && party && vchType && vchNo) {
        const debit = dri >= 0 ? toNumber(r[dri]) : null, credit = cri >= 0 ? toNumber(r[cri]) : null;
        current = { key: `${sheet}|${i + 1}`, file, sheet, row: i + 1, date, party, vchType, vchNo, debit, credit, amount: debit ?? credit, refs: [] };
        out.push(current);
        continue;
      }
      if (current && !date && !vchType && party && !REF_KINDS.test(party) && current.counter === undefined && current.refs.length === 0) { current.counter = party; continue; }
      if (current && !date && REF_KINDS.test(party)) {
        // ref text, amount and Dr/Cr sit at fixed offsets from the
        // Particulars column in every real Day Book seen (+1, +3, +4).
        let amount: number | null = null;
        for (let k = pi + 2; k <= pi + 4 && amount == null; k++) amount = toNumber(r[k]);
        current.refs.push({ kind: party, ref: text(r[pi + 1]), amount, drcr: text(r[pi + 4]), row: i + 1 });
      }
    }
  }
  return out;
}

// A lot number is <product-prefix>/<6-digit serial>/<FY>, e.g. RB-G2/091403/26-27.
// A payment "Agst Ref" appends the supplier invoice after it. Position alone
// never decides which part is which: callers must confirm the suffix against
// the Gate Entry's own supplier invoice (invoiceMatches) before treating it as
// the invoice.
const COMPOSITE = /^([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*\/\d{6,8}\/\d{2}-\d{2})(?:\/(.+))?$/i;
export function splitCompositeRef(ref: string): { lot: string; rest: string } | null {
  const m = text(ref).replace(/\s+/g, '').match(COMPOSITE);
  return m ? { lot: m[1].toUpperCase(), rest: m[2] || '' } : null;
}

const normInv = (v: string) => text(v).toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+/, '');
export function invoiceMatches(rest: string, invoice: string): boolean {
  const inv = normInv(invoice);
  if (!inv || !rest) return false;
  if (normInv(rest) === inv) return true;
  const tokens = rest.split('/').filter(t => t && !/^\d{2,4}-\d{2,4}$/.test(t));
  return tokens.some(t => normInv(t) === inv);
}

export type PaymentRef = { voucher: TallyLedgerVoucher; ref: TallyRef; lot: string; rest: string };
// creditsByRef: every credit "Agst Ref" line keyed by its bill reference (spaces removed, upper case) — customer receipts / credit notes against a sales invoice.
// byVchNo: vouchers by their own voucher number (a purchase booking carries the ERP receipt number as its voucher number).
// newRefByLot: "New Ref" lines whose reference is a lot composite (RB-RG1/091502/26-27/154) by lot — the lot a purchase booking books.
// coverage: first/last voucher date in the uploaded Day Book, so "no payment found" can say what the file actually covers.
// paymentsByRef: every debit "Agst Ref" line on a Payment voucher, by its reference text (spaces removed, upper case) — how a bill
//   that is not a lot (water, store material, services) is shown to be paid.
// rangePayments: Payment lines whose reference is a date range ("29.08.26 to 04.09.26") — weekly payments for water and similar
//   supplies; they settle every trip dated inside the range.
export type RangePayment = { voucher: TallyLedgerVoucher; ref: TallyRef; from: string; to: string; single?: boolean };
export type LedgerIndex = {
  byKey: Map<string, TallyLedgerVoucher>; paymentsByLot: Map<string, PaymentRef[]>; byNewRef: Map<string, TallyLedgerVoucher[]>; creditsByRef: Map<string, { voucher: TallyLedgerVoucher; ref: TallyRef }[]>;
  byVchNo: Map<string, TallyLedgerVoucher[]>; newRefByLot: Map<string, PaymentRef[]>; coverage: { from: string; to: string } | null;
  paymentsByRef: Map<string, { voucher: TallyLedgerVoucher; ref: TallyRef }[]>; rangePayments: RangePayment[];
  /** Until about 7 Sep 2026 the ERP wrote bill references as "<serial>/<invoice>" (090104/MBS/731/26-27) with no product prefix; those are keyed by the 6-digit serial and must be confirmed against the party. */
  bySerial: Map<string, PaymentRef[]>;
  /** Suppliers credited by "Water Expenses" journals (with the journal dates) — the ledgers that supply water. */
  waterSuppliers: Map<string, string[]>;
};

const SERIAL_REF = /^(\d{6,8})[\/-](.+)$/;

const RANGE_REF = /(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\s*(?:to|-)\s*(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/i;
const isoDate = (d: string, m: string, y: string) => `${y.length === 2 ? `20${y}` : y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
// A single date ("23.09.26") on a weekly supply payment means "up to that day" — the previous week up to it.
const SINGLE_DATE_REF = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/;
const validIso = (iso: string) => /^\d{4}-\d{2}-\d{2}$/.test(iso) && !Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) && new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso;
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export function buildLedgerIndex(vouchers: TallyLedgerVoucher[]): LedgerIndex {
  const byKey = new Map(vouchers.map(v => [v.key, v]));
  const paymentsByLot = new Map<string, PaymentRef[]>();
  const byNewRef = new Map<string, TallyLedgerVoucher[]>();
  const creditsByRef = new Map<string, { voucher: TallyLedgerVoucher; ref: TallyRef }[]>();
  const byVchNo = new Map<string, TallyLedgerVoucher[]>();
  const newRefByLot = new Map<string, PaymentRef[]>();
  const paymentsByRef = new Map<string, { voucher: TallyLedgerVoucher; ref: TallyRef }[]>();
  const rangePayments: RangePayment[] = [];
  const bySerial = new Map<string, PaymentRef[]>();
  const waterSuppliers = new Map<string, string[]>();
  let from = '', to = '';
  for (const v of vouchers) {
    const vk = text(v.vchNo).toUpperCase().replace(/\s+/g, '');
    if (vk) (byVchNo.get(vk) || byVchNo.set(vk, []).get(vk)!).push(v);
    if (v.date) { if (!from || v.date < from) from = v.date; if (!to || v.date > to) to = v.date; }
    if (/^water expenses/i.test(text(v.party)) && v.counter) { const k = v.counter.toUpperCase(); (waterSuppliers.get(k) || waterSuppliers.set(k, []).get(k)!).push(v.date); }
  }
  for (const v of vouchers) for (const r of v.refs) {
    const split = splitCompositeRef(r.ref);
    if (!split) { const sm = text(r.ref).replace(/\s+/g, '').match(SERIAL_REF); if (sm) (bySerial.get(sm[1]) || bySerial.set(sm[1], []).get(sm[1])!).push({ voucher: v, ref: r, lot: sm[1], rest: sm[2] }); }
    if (split) {
      const a = paymentsByLot.get(split.lot) || []; a.push({ voucher: v, ref: r, lot: split.lot, rest: split.rest }); paymentsByLot.set(split.lot, a);
      if (/new ref/i.test(r.kind)) { const n = newRefByLot.get(split.lot) || []; n.push({ voucher: v, ref: r, lot: split.lot, rest: split.rest }); newRefByLot.set(split.lot, n); }
    }
    if (/agst ref/i.test(r.kind) && /^cr/i.test(r.drcr)) { const k = text(r.ref).toUpperCase().replace(/\s+/g, ''); const a = creditsByRef.get(k) || []; a.push({ voucher: v, ref: r }); creditsByRef.set(k, a); }
    if (/new ref/i.test(r.kind)) { const k = text(r.ref).toUpperCase(); const a = byNewRef.get(k) || []; a.push(v); byNewRef.set(k, a); }
    if (/agst ref/i.test(r.kind) && /^dr/i.test(r.drcr) && /payment/i.test(v.vchType)) {
      const k = text(r.ref).toUpperCase().replace(/\s+/g, ''); if (k) (paymentsByRef.get(k) || paymentsByRef.set(k, []).get(k)!).push({ voucher: v, ref: r });
      const m = text(r.ref).match(RANGE_REF);
      if (m) { const f = isoDate(m[1], m[2], m[3]), t = isoDate(m[4], m[5], m[6]); if (validIso(f) && validIso(t) && f <= t) rangePayments.push({ voucher: v, ref: r, from: f, to: t }); }
      else { const sd = text(r.ref).match(SINGLE_DATE_REF); if (sd) { const to = isoDate(sd[1], sd[2], sd[3]); if (validIso(to)) rangePayments.push({ voucher: v, ref: r, from: addDays(to, -6), to, single: true }); } }
    }
  }
  return { byKey, paymentsByLot, byNewRef, creditsByRef, byVchNo, newRefByLot, coverage: from ? { from, to } : null, paymentsByRef, rangePayments, bySerial, waterSuppliers };
}
