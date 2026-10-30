import * as XLSX from 'xlsx';
import { text } from '@/lib/reconciliation/normalize';
import { calendarDate } from '@/lib/reconciliation/parsers';
import { dayOf, type OpenBill, type PartyOutstanding, type Scope, type Side } from './engine';

// Tally's own Outstandings exports. They are exact as of the date they were printed (and carry bills from before the Day Book
// starts), so when one is uploaded it is used in place of the Day Book figures for that side:
//   - "Pending Bills" of Sundry Debtors / Sundry Creditors: one line per pending bill.
//   - "Group Summary" of Sundry Debtors / Sundry Creditors: one closing balance per party (no bills).
// The Excel export does not print a minus sign: whether an amount is Dr or Cr lives in the cell's number format (0.00" Dr" /
// 0.00" Cr"), so the cell formats are read, not just the values.

export type TallyBillRow = { party: string; ref: string; date: string; opening: number; pending: number; dueOn: string; overdueDays: number };
export type TallyBalanceRow = { party: string; balance: number };
export type TallyReport =
  | { kind: 'bills'; side: Side; asOf: string; rows: TallyBillRow[] }
  | { kind: 'summary'; side: Side; asOf: string; rows: TallyBalanceRow[] };

const hdr = (v: unknown) => text(v).toLowerCase().replace(/[^a-z0-9]/g, '');
const round2 = (n: number) => Math.round(n * 100) / 100;

/** +1 when the cell is printed Dr, -1 when Cr, 0 when the format says neither. */
function drCr(cell: XLSX.CellObject | undefined): 1 | -1 | 0 {
  const f = `${cell?.z ?? ''} ${cell?.w ?? ''}`;
  if (/\bCr\b/i.test(f)) return -1;
  if (/\bDr\b/i.test(f)) return 1;
  return 0;
}

/** Recognises a Tally Pending Bills / Group Summary export, or returns null (the file is something else, e.g. a Day Book). */
export function detectTallyReport(ws: XLSX.WorkSheet): TallyReport | null {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });
  const head = rows.slice(0, 16).flat().map(text).join(' | ');
  const grp = head.match(/sundry\s+(debtors|creditors)/i);
  if (!grp) return null;
  const side: Side = /debtors/i.test(grp[1]) ? 'debtor' : 'creditor';
  const span = head.match(/\d{1,2}-[A-Za-z]{3}-\d{2,4}\s+to\s+(\d{1,2}-[A-Za-z]{3}-\d{2,4})/i);
  const asOf = calendarDate(span?.[1]);
  if (!asOf) return null;
  // Debtors are owed to us on the Dr side, creditors on the Cr side: a bill on the other side is an advance (negative).
  const natural = side === 'debtor' ? 1 : -1;
  const at = (r: number, c: number) => ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;

  const bi = rows.findIndex(r => r.some(c => hdr(c) === 'refno') && r.some(c => hdr(c) === 'partysname' || hdr(c) === 'party'));
  if (bi >= 0 && /pending\s*bills/i.test(head)) {
    const h = rows[bi].map(hdr);
    const di = h.indexOf('date'), ri = h.indexOf('refno'), pi = h.findIndex(x => x === 'partysname' || x === 'party');
    const oi = h.indexOf('opening'), pen = h.indexOf('pending'), dui = h.indexOf('dueon'), ovi = h.indexOf('overdue');
    const out: TallyBillRow[] = [];
    for (let i = bi + 1; i < rows.length; i++) {
      const r = rows[i];
      const party = text(r[pi]), ref = text(r[ri]), date = dayOf(r[di]);
      if (!party || !date || typeof r[pen] !== 'number') continue; // header continuation / totals line
      const sgn = (c: number) => { const m = drCr(at(i, c)); return m === 0 ? 1 : m === natural ? 1 : -1; };
      out.push({ party, ref, date, opening: round2(((r[oi] as number) || 0) * sgn(oi)), pending: round2((r[pen] as number) * sgn(pen)), dueOn: dayOf(r[dui]) || date, overdueDays: Number(text(r[ovi])) || 0 });
    }
    if (!out.length) return null;
    return { kind: 'bills', side, asOf, rows: out };
  }

  const si = rows.findIndex(r => hdr(r[0]) === 'particulars');
  if (si >= 0 && /group\s*summary/i.test(head)) {
    const out: TallyBalanceRow[] = [];
    // The two amount columns are headed Debit and Credit; the closing balance sits in one of them.
    for (let i = si + 1; i < rows.length; i++) {
      const r = rows[i], party = text(r[0]);
      if (!party || /^(debit|credit|closing balance|grand total)$/i.test(party) || (typeof r[1] !== 'number' && typeof r[2] !== 'number')) continue;
      const dr = typeof r[1] === 'number' ? r[1] : 0, cr = typeof r[2] === 'number' ? r[2] : 0;
      out.push({ party, balance: round2(side === 'creditor' ? cr - dr : dr - cr) });
    }
    if (!out.length) return null;
    return { kind: 'summary', side, asOf, rows: out };
  }
  return null;
}

const days = (from: string, to: string) => Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000));

/** Shapes a Tally report like the Day Book result so the same screens can show it. */
export function tallyToOutstanding(report: TallyReport, scopeOf: (party: string) => Scope): { parties: PartyOutstanding[]; bills: OpenBill[] } {
  const side = report.side;
  const parties = new Map<string, PartyOutstanding>();
  const bills: OpenBill[] = [];
  const party = (name: string): PartyOutstanding => {
    let p = parties.get(name);
    if (!p) { p = { party: name, side, scope: scopeOf(name), outstanding: 0, dueBills: 0, advances: 0, raised: 0, settled: 0, openBills: 0, oldestDays: 0, settledAgainstEarlier: 0, why: '' }; parties.set(name, p); }
    return p;
  };
  if (report.kind === 'bills') {
    for (const r of report.rows) {
      const p = party(r.party), age = days(r.date, report.asOf);
      p.outstanding = round2(p.outstanding + r.pending);
      if (r.pending > 0) { p.dueBills = round2(p.dueBills + r.pending); p.oldestDays = Math.max(p.oldestDays, age); } else p.advances = round2(p.advances + r.pending);
      p.raised = round2(p.raised + r.opening); p.settled = round2(p.settled + (r.opening - r.pending)); p.openBills++;
      bills.push({ party: r.party, side, scope: p.scope, ref: r.ref, date: r.date, voucherType: 'Tally pending bill', voucherNo: '', raised: r.opening, settled: round2(r.opening - r.pending), outstanding: r.pending, ageDays: age, narration: '' });
    }
  } else {
    for (const r of report.rows) {
      if (Math.abs(r.balance) < 0.5) continue;
      const p = party(r.party);
      p.outstanding = r.balance; p.dueBills = r.balance > 0 ? r.balance : 0; p.advances = r.balance < 0 ? r.balance : 0;
    }
  }
  const list = [...parties.values()].sort((a, b) => Math.abs(b.outstanding) - Math.abs(a.outstanding));
  bills.sort((a, b) => a.party.localeCompare(b.party) || a.date.localeCompare(b.date));
  return { parties: list, bills };
}
