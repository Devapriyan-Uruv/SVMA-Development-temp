
import { text, toNumber } from '@/lib/reconciliation/normalize';
import { calendarDate } from '@/lib/reconciliation/parsers';

// Creditors / Debtors from a Tally Day Book. Every bill-wise ledger
// carries New Ref / Agst Ref lines directly beneath its ledger line.

export type Side = 'creditor' | 'debtor';
export type Scope = 'local' | 'international';

export type DayBookReferences = {
  contractNo?: string;
  salesContractNo?: string;
  boeNo?: string;
  invoiceNo?: string;
};

export type DayBookLine = {
  name: string;
  dr: number | null;
  cr: number | null;
  refs: {
    kind: string;
    ref: string;
    amount: number;
    drcr: 'Dr' | 'Cr';
  }[];
};

export type DayBookVoucher = {
  date: string;
  vchType: string;
  vchNo: string;
  contractNo?: string;
  salesContractNo?: string;
  boeNo?: string;
  invoiceNo?: string;
  lines: DayBookLine[];
  narration: string[];
};

export const VOUCHER_VERSION = 2;

export type CompactVoucher = {
  ver?: number;
  date: string;
  vchType: string;
  vchNo: string;
  head: string;
  lines: DayBookLine[];
  imp: boolean;
  exp: boolean;
  usd: boolean;
  note: string;
};

export type OpenBill = {
  party: string;
  side: Side;
  scope: Scope;
  ref: string;
  date: string;
  voucherType: string;
  voucherNo: string;
  raised: number;
  settled: number;
  outstanding: number;
  ageDays: number;
  narration: string;
  billValue?: number;
  noteDeduction?: number;
  journalDeduction?: number;
  settlementValue?: number;
  paid?: number;
};

export type PartyOutstanding = {
  party: string;
  side: Side;
  scope: Scope;
  outstanding: number;
  dueBills: number;
  advances: number;
  raised: number;
  settled: number;
  openBills: number;
  oldestDays: number;
  settledAgainstEarlier: number;
  why: string;
};

export type OutstandingResult = {
  periodFrom: string;
  periodTo: string;
  vouchers: number;
  parties: PartyOutstanding[];
  bills: OpenBill[];
  warnings: string[];
};

const REF_KINDS = /^(new ref|agst ref|advance|on account)$/i;
const hdr = (v: unknown) =>
  text(v).toLowerCase().replace(/[^a-z0-9]/g, '');
const idx = (row: unknown[], aliases: string[]) =>
  row.findIndex(c => aliases.map(hdr).includes(hdr(c)));
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Extract labelled references from a voucher description.
 *
 * Sales Contract No is kept separately from Contract No.
 * Example:
 * Sales contract No:20260701
 * contract no:PI-20260701-SVMA
 * BOE No:123456789
 */
export function extractDayBookReferences(
  source: string,
): DayBookReferences {
  const result: DayBookReferences = {};

  const value = '([A-Z0-9][A-Z0-9./_-]*)';

  const referenceRegex =
    /\b(sales\s+contract|contract|boe|invoice)\s*(?:no\.?|number)\s*[:#-]\s*([A-Z0-9][A-Z0-9./_-]*)/gi;

  for (const match of source.matchAll(referenceRegex)) {
    const label = match[1].toLowerCase().replace(/\s+/g, ' ');
    const extracted = match[2].replace(/[.,;]+$/, '');

    if (label === 'sales contract') {
      result.salesContractNo ??= extracted;
    } else if (label === 'contract') {
      result.contractNo ??= extracted;
    } else if (label === 'boe') {
      result.boeNo ??= extracted;
    } else if (label === 'invoice') {
      result.invoiceNo ??= extracted;
    }
  }

  return result;
}

/**
 * Excel stores a date as a day number. Date objects can sit a few
 * seconds off midnight before it in IST, so round to the nearest day.
 */
export function dayOf(v: unknown): string {
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    return new Date(
      Date.UTC(1899, 11, 30) + Math.round(v) * 86400000,
    )
      .toISOString()
      .slice(0, 10);
  }

  if (v instanceof Date && Number.isFinite(v.getTime())) {
    return calendarDate(new Date(v.getTime() + 12 * 3600000));
  }

  return calendarDate(v);
}

/**
 * Reads Day Book sheet rows:
 * header row, voucher row, ledger rows, reference rows and narration rows.
 *
 * Supports optional Contract No, BOE No and Invoice No columns.
 * It also extracts these references from descriptions and narration.
 */
export function parseDayBookRows(
  rows: unknown[][],
): DayBookVoucher[] {
  const hi = rows.slice(0, 60).findIndex(
    r =>
      idx(r, ['Date']) >= 0 &&
      idx(r, ['Particulars']) >= 0 &&
      idx(r, ['Vch Type', 'Voucher Type']) >= 0,
  );

  if (hi < 0) {
    throw new Error(
      'This does not look like a Tally Day Book — the Date / Particulars / Vch Type header row was not found.',
    );
  }

  const h = rows[hi];

  const di = idx(h, ['Date']);
  const pi = idx(h, ['Particulars']);
  const ti = idx(h, ['Vch Type', 'Voucher Type']);
  const ni = idx(h, ['Vch No.', 'Voucher No.', 'Vch No']);

  const dri = idx(h, ['Debit Amount', 'Debit']);
  const cri = idx(h, ['Credit Amount', 'Credit']);

  // Optional columns. Existing Tally exports need not contain them.
  const ci = idx(h, ['Contract No', 'Contract Number']);
  const sci = idx(h, ['Sales Contract No', 'Sales Contract Number']);
  const bi = idx(h, ['BOE No', 'BOE Number']);
  const ii = idx(h, ['Invoice No', 'Invoice Number']);

  if (dri < 0 && cri < 0) {
    throw new Error(
      'The Day Book has no Debit / Credit amount columns.',
    );
  }

  const out: DayBookVoucher[] = [];
  let cur: DayBookVoucher | null = null;

  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];

    const date = dayOf(r[di]);
    const name = text(r[pi]);
    const vchType = text(r[ti]);

    const dr = dri >= 0 ? toNumber(r[dri]) : null;
    const cr = cri >= 0 ? toNumber(r[cri]) : null;

    if (date && name && vchType) {
      cur = {
  date,
  vchType,
  vchNo: ni >= 0 ? text(r[ni]) : '',
  contractNo: contractI >= 0 ? text(r[contractI]) || undefined : undefined,
  salesContractNo: salesContractI >= 0 ? text(r[salesContractI]) || undefined : undefined,
  boeNo: boeI >= 0 ? text(r[boeI]) || undefined : undefined,
  invoiceNo: invoiceI >= 0 ? text(r[invoiceI]) || undefined : undefined,
  lines: [],
  narration: [],
};

      if (!/^\(cancelled\)$/i.test(name)) {
        cur.lines.push({
          name,
          dr,
          cr,
          refs: [],
        });
      }

      out.push(cur);
      continue;
    }

    if (!cur || date || !name) continue;

    if (REF_KINDS.test(name)) {
      // Ref text, amount and Dr/Cr sit at fixed offsets from
      // the Particulars column (+1, +3/+4, +4).
      let amount: number | null = null;

      for (let k = pi + 2; k <= pi + 4 && amount == null; k++) {
        amount = toNumber(r[k]);
      }

      const last = cur.lines[cur.lines.length - 1];

      if (last && amount != null && text(r[pi + 1])) {
        last.refs.push({
          kind: name,
          ref: text(r[pi + 1]),
          amount,
          drcr: /^cr/i.test(text(r[pi + 4])) ? 'Cr' : 'Dr',
        });
      }

      continue;
    }

    if (dr != null || cr != null) {
      cur.lines.push({
        name,
        dr,
        cr,
        refs: [],
      });
    } else {
      cur.narration.push(name);
    }
  }

  // Extract references from every voucher's ledger descriptions
  // and narration. Keep the original descriptions unchanged.
  for (const voucher of out) {
    const description = [
      ...voucher.lines.map(line => line.name),
      ...voucher.narration,
    ].join(' | ');

    const extracted = extractDayBookReferences(description);

    voucher.contractNo ??= extracted.contractNo;
    voucher.salesContractNo ??= extracted.salesContractNo;
    voucher.boeNo ??= extracted.boeNo;
    voucher.invoiceNo ??= extracted.invoiceNo;
  }

  return out;
}

/**
 * Keeps vouchers carrying bill references for Creditors / Debtors.
 */
export function compactVouchers(
  vouchers: DayBookVoucher[],
): {
  vouchers: CompactVoucher[];
  total: number;
  from: string;
  to: string;
} {
  const out: CompactVoucher[] = [];
  let from = '';
  let to = '';

  for (const v of vouchers) {
    if (!from || v.date < from) from = v.date;
    if (!to || v.date > to) to = v.date;

    if (!v.lines.some(l => l.refs.length)) continue;

    const vtext = `${v.vchType} ${v.lines.map(l => l.name).join(' ')}`;
    const narr = v.narration.join(' ');

    out.push({
      ver: VOUCHER_VERSION,
      date: v.date,
      vchType: v.vchType,
      vchNo: v.vchNo,
      head: v.lines[0]?.name || '',
      lines: v.lines.filter(l => l.refs.length),
      imp: /import/i.test(vtext),
      exp: /export/i.test(vtext),
      usd: /usd|\$|inr \d/i.test(narr),
      note: narr.slice(0, 200),
    });
  }

  return {
    vouchers: out,
    total: vouchers.length,
    from,
    to,
  };
}

/**
 * A voucher's identity across uploads.
 */
export function voucherKey(v: CompactVoucher): string {
  return [
    v.date,
    v.vchType.toUpperCase().trim(),
    v.vchNo.trim(),
    partyKey(v.head),
    refKey(v.lines[0]?.refs[0]?.ref || ''),
  ].join('|');
}

export const partyKey = (n: string) =>
  n
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/[\s.,]+$/, '')
    .trim();

const refKey = (r: string) =>
  r.toUpperCase().replace(/\s+/g, '');

const isBooking = (t: string) =>
  !/(order|payment|receipt|contra)/i.test(t);

export const FOREIGN_NAME =
  /\b(pte|fze|fzco|fz|llc|nv|ltd\.?, ?(singapore|dubai|freetown|colombo)|singapore|dubai|uae|africa|nigeria|naijeria|freetown|colombo|philippines|sri lanka|indonesia|malaysia|ghana|tanzania|bangladesh|nepal|usa)\b/i;

type Ev = {
  kind: string;
  ref: string;
  amount: number;
  drcr: 'Dr' | 'Cr';
  date: string;
  vchType: string;
  vchNo: string;
  note: string;
};

type PartyAcc = {
  names: Map<string, number>;
  events: Ev[];
  raiseCr: number;
  raiseDr: number;
  settleDr: number;
  settleCr: number;
  imp: number;
  exp: number;
  usd: number;
  foreign: boolean;
};

export function computeOutstanding(
  vouchers: CompactVoucher[],
  coverage: { from: string; to: string; total: number },
): OutstandingResult {
  const parties = new Map<string, PartyAcc>();

  const acc = (name: string): PartyAcc => {
    const k = partyKey(name);
    let p = parties.get(k);

    if (!p) {
      p = {
        names: new Map(),
        events: [],
        raiseCr: 0,
        raiseDr: 0,
        settleDr: 0,
        settleCr: 0,
        imp: 0,
        exp: 0,
        usd: 0,
        foreign:
          FOREIGN_NAME.test(name) ||
          /\b(bc|bill collection)\b/i.test(name),
      };

      parties.set(k, p);
    }

    p.names.set(
      name.trim(),
      (p.names.get(name.trim()) || 0) + 1,
    );

    return p;
  };

  const periodFrom = coverage.from;
  const periodTo = coverage.to;

  for (const v of vouchers) {
    const narr = v.note;

    for (const l of v.lines) {
      if (!l.refs.length) continue;

      const p = acc(l.name);

      if (v.imp) p.imp++;
      if (v.exp) p.exp++;
      if (v.usd) p.usd++;

      for (const r of l.refs) {
        p.events.push({
          kind: r.kind,
          ref: r.ref,
          amount: r.amount,
          drcr: r.drcr,
          date: v.date,
          vchType: v.vchType,
          vchNo: v.vchNo,
          note: narr,
        });

        const raises = /new ref/i.test(r.kind)
          ? isBooking(v.vchType)
          : /^(sales|purchase)/i.test(v.vchType) &&
            !/order/i.test(v.vchType);

        if (raises) {
          if (r.drcr === 'Cr') p.raiseCr += r.amount;
          else p.raiseDr += r.amount;
        } else if (r.drcr === 'Dr') {
          p.settleDr += r.amount;
        } else {
          p.settleCr += r.amount;
        }
      }
    }
  }

  const outParties: PartyOutstanding[] = [];
  const outBills: OpenBill[] = [];
  const asOf = Date.parse(`${periodTo}T00:00:00Z`);

  for (const [, p] of parties) {
    const side: Side =
      p.raiseCr || p.raiseDr
        ? p.raiseCr >= p.raiseDr
          ? 'creditor'
          : 'debtor'
        : p.settleDr >= p.settleCr
          ? 'creditor'
          : 'debtor';

    const natural: 'Dr' | 'Cr' =
      side === 'creditor' ? 'Cr' : 'Dr';

    const name = [...p.names.entries()].sort(
      (a, b) => b[1] - a[1],
    )[0][0];

    const intl =
      p.foreign || (p.usd > 0 && (p.imp > 0 || p.exp > 0));

    const why = intl
      ? [
          p.foreign ? 'foreign name' : '',
          p.imp ? 'import voucher' : '',
          p.exp ? 'export voucher' : '',
          p.usd ? 'USD narration' : '',
        ]
          .filter(Boolean)
          .join(', ')
      : '';

    const scope: Scope = intl ? 'international' : 'local';

    const bills = new Map<string, Ev[]>();

    for (const e of p.events) {
      const key = refKey(e.ref);
      (bills.get(key) || bills.set(key, []).get(key)!).push(e);
    }

    let outstanding = 0;
    let due = 0;
    let adv = 0;
    let raised = 0;
    let settled = 0;
    let openBills = 0;
    let oldest = 0;
    let earlier = 0;

    const isBill = (e: Ev) =>
      /new ref/i.test(e.kind)
        ? isBooking(e.vchType)
        : /^(sales|purchase)/i.test(e.vchType) &&
          !/order/i.test(e.vchType);

    for (const evs of bills.values()) {
      const natEvs = evs.filter(e => e.drcr === natural);
      const oppEvs = evs.filter(e => e.drcr !== natural);
      const raisers = natEvs.filter(isBill);

      const advance =
        !raisers.length &&
        oppEvs.some(e =>
          /^(new ref|advance|on account)$/i.test(e.kind),
        );

      const r = natEvs.reduce((s, e) => s + e.amount, 0);
      const s = oppEvs.reduce((x, e) => x + e.amount, 0);

      const sum = (a: Ev[]) =>
        a.reduce((t, e) => t + e.amount, 0);

      const isNoteEv = (e: Ev) =>
        /(debit|credit) note/i.test(e.vchType);

      const isPayEv = (e: Ev) =>
        /(payment|receipt|contra)/i.test(e.vchType);

      const billValue = sum(raisers);
      const additions = sum(
        natEvs.filter(e => !raisers.includes(e)),
      );

      const noteDeduction =
        sum(oppEvs.filter(isNoteEv)) - additions;

      const paidAmt = sum(oppEvs.filter(isPayEv));

      const journalDeduction =
        s - sum(oppEvs.filter(isNoteEv)) - paidAmt;

      if (!raisers.length && !advance) {
        earlier += r + s;
        continue;
      }

      raised += r;
      settled += s;

      const open = round2(r - s);
      outstanding += open;

      if (open > 0) due += open;
      else adv += open;

      if (Math.abs(open) < 0.5) continue;

      const pool = raisers.length ? raisers : oppEvs;

      const first = pool
        .slice()
        .sort(
          (a, b) =>
            (/new ref/i.test(a.kind) ===
            /new ref/i.test(b.kind)
              ? 0
              : /new ref/i.test(a.kind)
                ? -1
                : 1) || a.date.localeCompare(b.date),
        )[0];

      const ageDays = Math.max(
        0,
        Math.round(
          (asOf - Date.parse(`${first.date}T00:00:00Z`)) /
            86400000,
        ),
      );

      openBills++;

      if (open > 0) oldest = Math.max(oldest, ageDays);

      outBills.push({
        party: name,
        side,
        scope,
        ref: first.ref,
        date: first.date,
        voucherType: first.vchType,
        voucherNo: first.vchNo,
        raised: round2(r),
        settled: round2(s),
        outstanding: open,
        billValue: round2(billValue),
        noteDeduction: round2(noteDeduction),
        journalDeduction: round2(journalDeduction),
        settlementValue: round2(
          billValue - noteDeduction - journalDeduction,
        ),
        paid: round2(paidAmt),
        ageDays,
        narration: first.note.slice(0, 160),
      });
    }

    if (!openBills && Math.abs(outstanding) < 0.5 && !earlier) {
      continue;
    }

    outParties.push({
      party: name,
      side,
      scope,
      outstanding: round2(outstanding),
      dueBills: round2(due),
      advances: round2(adv),
      raised: round2(raised),
      settled: round2(settled),
      openBills,
      oldestDays: oldest,
      settledAgainstEarlier: round2(earlier),
      why,
    });
  }

  outParties.sort(
    (a, b) =>
      Math.abs(b.outstanding) - Math.abs(a.outstanding),
  );

  outBills.sort(
    (a, b) =>
      a.party.localeCompare(b.party) ||
      a.date.localeCompare(b.date),
  );

  const warnings: string[] = [];

  if (
    outParties.some(p => p.settledAgainstEarlier > 0)
  ) {
    warnings.push(
      'Payments or notes against bills raised before the Day Book starts are shown as "paid or adjusted against earlier bills" — those older bills (and any balance on them) are not in this Day Book, so only bills raised in this period can show an outstanding.',
    );
  }

  return {
    periodFrom,
    periodTo,
    vouchers: coverage.total,
    parties: outParties,
    bills: outBills,
    warnings,
  };
}
