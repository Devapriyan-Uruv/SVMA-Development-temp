import { text, toNumber } from '@/lib/reconciliation/normalize';
import { calendarDate } from '@/lib/reconciliation/parsers';

// Creditors / Debtors from a Tally Day Book. Every bill-wise ledger (supplier, customer, transporter ...) carries "New Ref" /
// "Agst Ref" lines directly beneath its own ledger line, so the open items of a party are the bill references that have been
// raised but not fully settled. Nothing is read from a trial balance: a bill raised before the Day Book starts only shows up
// through payments made against it, so those are reported separately as "settled against earlier bills" and never as a balance.

export type Side = 'creditor' | 'debtor';
export type Scope = 'local' | 'international';

export type DayBookLine = { name: string; dr: number | null; cr: number | null; refs: { kind: string; ref: string; amount: number; drcr: 'Dr' | 'Cr' }[] };
export type DayBookVoucher = { date: string; vchType: string; vchNo: string; lines: DayBookLine[]; narration: string[] };

/** Only what the outstanding needs from a voucher — the bill-bearing ledger lines and the flags that decide Local / International. */
/** Bumped when the parsing changes what is stored, so vouchers saved by an older parser are replaced rather than duplicated. */
export const VOUCHER_VERSION = 2;
export type CompactVoucher = { ver?: number; date: string; vchType: string; vchNo: string; head: string; lines: DayBookLine[]; imp: boolean; exp: boolean; usd: boolean; note: string };

export type OpenBill = {
  party: string; side: Side; scope: Scope; ref: string; date: string; voucherType: string; voucherNo: string;
  raised: number; settled: number; outstanding: number; ageDays: number; narration: string;
  /** The bill's own breakdown: first booking, then the debit / credit note and journal deductions, then the settlement value (what is payable once the deductions are made), then what was paid. */
  billValue?: number; noteDeduction?: number; journalDeduction?: number; settlementValue?: number; paid?: number;
};
export type PartyOutstanding = {
  party: string; side: Side; scope: Scope; outstanding: number; /** open bills still to be paid / collected */ dueBills: number; /** advances paid or received that no bill has used yet (shown negative) */ advances: number; raised: number; settled: number; openBills: number;
  oldestDays: number; settledAgainstEarlier: number; why: string;
};
export type OutstandingResult = {
  periodFrom: string; periodTo: string; vouchers: number; parties: PartyOutstanding[]; bills: OpenBill[]; warnings: string[];
};

const REF_KINDS = /^(new ref|agst ref|advance|on account)$/i;
const hdr = (v: unknown) => text(v).toLowerCase().replace(/[^a-z0-9]/g, '');
const idx = (row: unknown[], aliases: string[]) => row.findIndex(c => aliases.map(hdr).includes(hdr(c)));
const round2 = (n: number) => Math.round(n * 100) / 100;
/** Excel stores a date as a day number; the reader's Date objects sit a few seconds off midnight (before it, in IST), which
 * made every date land one day early when read in a browser. Take the day number, or round a Date to the nearest day. */
export function dayOf(v: unknown): string {
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);
  if (v instanceof Date && Number.isFinite(v.getTime())) return calendarDate(new Date(v.getTime() + 12 * 3600000));
  return calendarDate(v);
}

/** Reads the Day Book sheet rows (header row, then voucher / ledger / reference / narration lines) into vouchers. */
export function parseDayBookRows(rows: unknown[][]): DayBookVoucher[] {
  const hi = rows.slice(0, 60).findIndex(r => idx(r, ['Date']) >= 0 && idx(r, ['Particulars']) >= 0 && idx(r, ['Vch Type', 'Voucher Type']) >= 0);
  if (hi < 0) throw new Error('This does not look like a Tally Day Book — the Date / Particulars / Vch Type header row was not found.');
  const h = rows[hi];
  const di = idx(h, ['Date']), pi = idx(h, ['Particulars']), ti = idx(h, ['Vch Type', 'Voucher Type']), ni = idx(h, ['Vch No.', 'Voucher No.', 'Vch No']);
  const dri = idx(h, ['Debit Amount', 'Debit']), cri = idx(h, ['Credit Amount', 'Credit']);
  if (dri < 0 && cri < 0) throw new Error('The Day Book has no Debit / Credit amount columns.');
  const out: DayBookVoucher[] = [];
  let cur: DayBookVoucher | null = null;
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    const date = dayOf(r[di]), name = text(r[pi]), vchType = text(r[ti]);
    const dr = dri >= 0 ? toNumber(r[dri]) : null, cr = cri >= 0 ? toNumber(r[cri]) : null;
    if (date && name && vchType) {
      cur = { date, vchType, vchNo: ni >= 0 ? text(r[ni]) : '', lines: [], narration: [] };
      if (!/^\(cancelled\)$/i.test(name)) cur.lines.push({ name, dr, cr, refs: [] });
      out.push(cur);
      continue;
    }
    if (!cur || date || !name) continue;
    if (REF_KINDS.test(name)) {
      // Ref text, amount and Dr/Cr sit at fixed offsets from the Particulars column (+1, +3/+4, +4) in every real Day Book.
      let amount: number | null = null;
      for (let k = pi + 2; k <= pi + 4 && amount == null; k++) amount = toNumber(r[k]);
      const last = cur.lines[cur.lines.length - 1];
      if (last && amount != null && text(r[pi + 1])) last.refs.push({ kind: name, ref: text(r[pi + 1]), amount, drcr: /^cr/i.test(text(r[pi + 4])) ? 'Cr' : 'Dr' });
      continue;
    }
    if (dr != null || cr != null) cur.lines.push({ name, dr, cr, refs: [] });
    else cur.narration.push(name);
  }
  return out;
}

/** Keeps the vouchers that carry bill references, with the Local / International evidence taken from the rest of the voucher. */
export function compactVouchers(vouchers: DayBookVoucher[]): { vouchers: CompactVoucher[]; total: number; from: string; to: string } {
  const out: CompactVoucher[] = [];
  let from = '', to = '';
  for (const v of vouchers) {
    if (!from || v.date < from) from = v.date;
    if (!to || v.date > to) to = v.date;
    if (!v.lines.some(l => l.refs.length)) continue;
    const vtext = `${v.vchType} ${v.lines.map(l => l.name).join(' ')}`, narr = v.narration.join(' ');
    out.push({ ver: VOUCHER_VERSION, date: v.date, vchType: v.vchType, vchNo: v.vchNo, head: v.lines[0]?.name || '', lines: v.lines.filter(l => l.refs.length), imp: /import/i.test(vtext), exp: /export/i.test(vtext), usd: /usd|\$|inr \d/i.test(narr), note: narr.slice(0, 200) });
  }
  return { vouchers: out, total: vouchers.length, from, to };
}

/** A voucher's identity across uploads: its date, type, number, head ledger and first bill reference. (Some vouchers have no
 * number, and the same supplier can have several on one day — the reference tells them apart.) */
export function voucherKey(v: CompactVoucher): string {
  return [v.date, v.vchType.toUpperCase().trim(), v.vchNo.trim(), partyKey(v.head), refKey(v.lines[0]?.refs[0]?.ref || '')].join('|');
}

export const partyKey = (n: string) => n.toUpperCase().replace(/\s+/g, ' ').replace(/[\s.,]+$/, '').trim();
const refKey = (r: string) => r.toUpperCase().replace(/\s+/g, '');
/** Types whose New Ref lines *raise* the party's own bill (a receipt/payment with a New Ref is an advance, not a bill). */
const isBooking = (t: string) => !/(order|payment|receipt|contra)/i.test(t);

export const FOREIGN_NAME = /\b(pte|fze|fzco|fz|llc|nv|ltd\.?, ?(singapore|dubai|freetown|colombo)|singapore|dubai|uae|africa|nigeria|naijeria|freetown|colombo|philippines|sri lanka|indonesia|malaysia|ghana|tanzania|bangladesh|nepal|usa)\b/i;

type Ev = { kind: string; ref: string; amount: number; drcr: 'Dr' | 'Cr'; date: string; vchType: string; vchNo: string; note: string };
type PartyAcc = { names: Map<string, number>; events: Ev[]; raiseCr: number; raiseDr: number; settleDr: number; settleCr: number; imp: number; exp: number; usd: number; foreign: boolean };

export function computeOutstanding(vouchers: CompactVoucher[], coverage: { from: string; to: string; total: number }): OutstandingResult {
  const parties = new Map<string, PartyAcc>();
  const acc = (name: string): PartyAcc => {
    const k = partyKey(name);
    let p = parties.get(k);
    if (!p) { p = { names: new Map(), events: [], raiseCr: 0, raiseDr: 0, settleDr: 0, settleCr: 0, imp: 0, exp: 0, usd: 0, foreign: FOREIGN_NAME.test(name) || /\b(bc|bill collection)\b/i.test(name) }; parties.set(k, p); }
    p.names.set(name.trim(), (p.names.get(name.trim()) || 0) + 1);
    return p;
  };
  const periodFrom = coverage.from, periodTo = coverage.to;
  for (const v of vouchers) {
    const narr = v.note;
    for (const l of v.lines) {
      if (!l.refs.length) continue;
      const p = acc(l.name);
      if (v.imp) p.imp++; if (v.exp) p.exp++; if (v.usd) p.usd++;
      for (const r of l.refs) {
        p.events.push({ kind: r.kind, ref: r.ref, amount: r.amount, drcr: r.drcr, date: v.date, vchType: v.vchType, vchNo: v.vchNo, note: narr });
        const raises = /new ref/i.test(r.kind) ? isBooking(v.vchType) : /^(sales|purchase)/i.test(v.vchType) && !/order/i.test(v.vchType);
        if (raises) { if (r.drcr === 'Cr') p.raiseCr += r.amount; else p.raiseDr += r.amount; }
        else if (r.drcr === 'Dr') p.settleDr += r.amount; else p.settleCr += r.amount;
      }
    }
  }

  const outParties: PartyOutstanding[] = [];
  const outBills: OpenBill[] = [];
  const asOf = Date.parse(`${periodTo}T00:00:00Z`);
  for (const [, p] of parties) {
    // A supplier's bills are raised by credits and cleared by debits; a customer's the other way round. Raised bills decide it;
    // a party with only settlements (a payment against an earlier bill) is read from the direction of those.
    const side: Side = p.raiseCr || p.raiseDr ? (p.raiseCr >= p.raiseDr ? 'creditor' : 'debtor') : p.settleDr >= p.settleCr ? 'creditor' : 'debtor';
    const natural: 'Dr' | 'Cr' = side === 'creditor' ? 'Cr' : 'Dr';
    const name = [...p.names.entries()].sort((a, b) => b[1] - a[1])[0][0];
    // International = a foreign-looking name, or a USD-denominated import/export voucher. An Indian clearing agent, shipping line
    // or insurer that merely appears in an import voucher is billed in rupees and stays Local.
    const intl = p.foreign || (p.usd > 0 && (p.imp > 0 || p.exp > 0));
    const why = intl ? [p.foreign ? 'foreign name' : '', p.imp ? 'import voucher' : '', p.exp ? 'export voucher' : '', p.usd ? 'USD narration' : ''].filter(Boolean).join(', ') : '';
    const scope: Scope = intl ? 'international' : 'local';

    const bills = new Map<string, Ev[]>();
    for (const e of p.events) (bills.get(refKey(e.ref)) || bills.set(refKey(e.ref), []).get(refKey(e.ref))!).push(e);
    let outstanding = 0, due = 0, adv = 0, raised = 0, settled = 0, openBills = 0, oldest = 0, earlier = 0;
    const isBill = (e: Ev) => /new ref/i.test(e.kind) ? isBooking(e.vchType) : /^(sales|purchase)/i.test(e.vchType) && !/order/i.test(e.vchType);
    for (const evs of bills.values()) {
      const natEvs = evs.filter(e => e.drcr === natural), oppEvs = evs.filter(e => e.drcr !== natural);
      const raisers = natEvs.filter(isBill);
      // Opposite-side entries that open a reference themselves (an advance paid / received) are a balance of their own.
      const advance = !raisers.length && oppEvs.some(e => /^(new ref|advance|on account)$/i.test(e.kind));
      const r = natEvs.reduce((s, e) => s + e.amount, 0), s = oppEvs.reduce((x, e) => x + e.amount, 0);
      // Bill value = the booking; deductions = debit / credit note and journal (charges, TDS); settlement value = bill value less the
      // deductions (a credit note on a supplier's bill adds, so it shows as a negative deduction); then payments give the outstanding.
      const sum = (a: Ev[]) => a.reduce((t, e) => t + e.amount, 0);
      const isNoteEv = (e: Ev) => /(debit|credit) note/i.test(e.vchType), isPayEv = (e: Ev) => /(payment|receipt|contra)/i.test(e.vchType);
      const billValue = sum(raisers), additions = sum(natEvs.filter(e => !raisers.includes(e)));
      const noteDeduction = sum(oppEvs.filter(isNoteEv)) - additions, paidAmt = sum(oppEvs.filter(isPayEv));
      const journalDeduction = s - sum(oppEvs.filter(isNoteEv)) - paidAmt; // journals and anything else posted against the bill
      if (!raisers.length && !advance) { earlier += r + s; continue; } // settled against a bill raised before the Day Book starts
      raised += r; settled += s;
      const open = round2(r - s);
      outstanding += open;
      if (open > 0) due += open; else adv += open;
      if (Math.abs(open) < 0.5) continue;
      const pool = raisers.length ? raisers : oppEvs;
      const first = pool.slice().sort((a, b) => (/new ref/i.test(a.kind) === /new ref/i.test(b.kind) ? 0 : /new ref/i.test(a.kind) ? -1 : 1) || a.date.localeCompare(b.date))[0];
      const ageDays = Math.max(0, Math.round((asOf - Date.parse(`${first.date}T00:00:00Z`)) / 86400000));
      openBills++; if (open > 0) oldest = Math.max(oldest, ageDays);
      outBills.push({ party: name, side, scope, ref: first.ref, date: first.date, voucherType: first.vchType, voucherNo: first.vchNo, raised: round2(r), settled: round2(s), outstanding: open, billValue: round2(billValue), noteDeduction: round2(noteDeduction), journalDeduction: round2(journalDeduction), settlementValue: round2(billValue - noteDeduction - journalDeduction), paid: round2(paidAmt), ageDays, narration: first.note.slice(0, 160) });
    }
    if (!openBills && Math.abs(outstanding) < 0.5 && !earlier) continue;
    outParties.push({ party: name, side, scope, outstanding: round2(outstanding), dueBills: round2(due), advances: round2(adv), raised: round2(raised), settled: round2(settled), openBills, oldestDays: oldest, settledAgainstEarlier: round2(earlier), why });
  }
  outParties.sort((a, b) => Math.abs(b.outstanding) - Math.abs(a.outstanding));
  outBills.sort((a, b) => a.party.localeCompare(b.party) || a.date.localeCompare(b.date));
  const warnings: string[] = [];
  if (outParties.some(p => p.settledAgainstEarlier > 0)) warnings.push('Payments or notes against bills raised before the Day Book starts are shown as "paid or adjusted against earlier bills" — those older bills (and any balance on them) are not in this Day Book, so only bills raised in this period can show an outstanding.');
  return { periodFrom, periodTo, vouchers: coverage.total, parties: outParties, bills: outBills, warnings };
}
