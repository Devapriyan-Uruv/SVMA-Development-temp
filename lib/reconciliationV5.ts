import * as XLSX from 'xlsx';
import { buildPhysicalSummary, parseDayBook, type DayBookVoucher, type Row } from './reconcile';
import { canonMaterial, canonParty, canonRef, canonVehicle, similarity, txt } from './normalize';

function n(v: unknown) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const x = Number(String(v ?? '').replace(/,/g, '').trim());
  return Number.isFinite(x) ? x : 0;
}
function toPaise(v: unknown) { return Math.round(n(v) * 100); }
function rupees(paise: number) { return paise / 100; }
function lotToken(v: unknown) {
  const s = txt(v).toUpperCase();
  const m = s.match(/(?:^|[^0-9])(\d{6})(?:[^0-9]|$)/);
  return m ? m[1] : canonRef(s);
}
function partySimilarity(a: unknown, b: unknown) { return similarity(canonParty(a), canonParty(b)); }
function parseDate(v: unknown) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  const s = txt(v); if (!s) return null;
  const dm = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (dm) { let y = Number(dm[3]); if (y < 100) y += 2000; return new Date(y, Number(dm[2]) - 1, Number(dm[1]), 12); }
  const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d;
}
function dayDiff(a: unknown, b: unknown) {
  const A = parseDate(a), B = parseDate(b);
  if (!A || !B) return 99;
  return Math.abs(Math.round((A.getTime() - B.getTime()) / 86400000));
}
function pick(row: Row, ...keys: string[]) {
  for (const k of keys) if (row[k] != null && txt(row[k])) return row[k];
  return null;
}
function weightKg(row: Row) {
  const direct = pick(row, 'Net Weight', 'NetWeight', 'Net Wt', 'NetWt', 'Net Weight(Kgs)', 'Net Weight (Kg)', 'Net Weight(Kg)', 'Net');
  if (direct != null) return n(direct);
  const key = Object.keys(row).find(k => /net.*weight|weight.*net/i.test(k));
  return key ? n(row[key]) : 0;
}
function mtFromKg(kg: number) { return kg > 1000 ? kg / 1000 : kg; }

export type AccountingRow = Row & {
  _kind: 'PURCHASE' | 'SALES'; _sheet: string; _date: string; _party: string;
  _voucherNo: string; _ref: string; _invoice: string; _qty: number;
};

/** Parse final Purchase/Sales accounting registers, not PO/SO order vouchers. */
export function parseAccountingRegisters(book: XLSX.WorkBook): AccountingRow[] {
  const out: AccountingRow[] = [];
  for (const sheet of book.SheetNames) {
    if (/^Day Book$/i.test(sheet) || /Marketing\s+Book/i.test(sheet)) continue;
    const sh = book.Sheets[sheet]; if (!sh) continue;
    const raw = XLSX.utils.sheet_to_json<unknown[]>(sh, { header: 1, defval: null, raw: false }) as unknown[][];
    const hi = raw.slice(0, 20).findIndex(r => r.some(v => /^Date$/i.test(txt(v))) && r.some(v => /Voucher No\.?/i.test(txt(v))));
    if (hi < 0) continue;
    const headers = raw[hi].map((v, i) => txt(v) || `_c${i}`);
    const isSales = headers.some(h => /Voucher Ref\.? No\.?/i.test(h)) || /^Sales/i.test(sheet);
    const isPurchase = /^Purchase/i.test(sheet) || headers.some(h => /Supplier Invoice No\.?/i.test(h));
    if (!isSales && !isPurchase) continue;
    raw.slice(hi + 1).forEach((r, idx) => {
      if (!r.some(v => txt(v))) return;
      const o: Row = Object.fromEntries(headers.map((h, c) => [h, r[c]]));
      if (/Grand Total|Total Values/i.test(txt(o.Particulars))) return;
      const date = parseDate(o.Date), voucher = txt(o['Voucher No.'] ?? o['Voucher No']);
      if (!date || !voucher) return;
      out.push({
        ...o,
        _row: hi + idx + 2,
        _sheet: sheet,
        _kind: isSales ? 'SALES' : 'PURCHASE',
        _date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
        _party: canonParty(o.Particulars),
        _voucherNo: voucher,
        _ref: canonRef(o['Voucher Ref. No.'] ?? o['Voucher Ref No']),
        _invoice: canonRef(o['Supplier Invoice No.'] ?? o['Supplier Invoice No']),
        _qty: n(o.Quantity),
      } as AccountingRow);
    });
  }
  return out;
}

function accountingMatch(kind: 'PURCHASE' | 'SALES', gate: Row, weigh: Row, rows: AccountingRow[], used: Set<string>) {
  const party = kind === 'PURCHASE' ? gate['Supplier Name'] : gate['Customer Name'];
  const ref = kind === 'SALES' ? canonRef(gate['Supplier Order No']) : canonRef(gate['Invoice Number']);
  const mt = mtFromKg(weightKg(weigh));
  const candidates = rows.filter(r => r._kind === kind && !used.has(`${r._sheet}|${r._row}`)).map(r => {
    const refExact = kind === 'SALES' ? !!ref && r._ref === ref : !!ref && r._invoice === ref;
    const ps = partySimilarity(party, r.Particulars);
    const qtyScore = mt && r._qty ? Math.max(0, 1 - Math.abs(r._qty - mt) / Math.max(mt, 1)) : 0;
    const dd = dayDiff(gate.Date, r._date);
    const dateScore = dd <= 1 ? 1 : dd <= 2 ? 0.5 : 0;
    const score = (refExact ? 0.55 : 0) + ps * 0.25 + qtyScore * 0.15 + dateScore * 0.05;
    return { r, score, refExact, ps, qtyScore, dd };
  }).filter(x => x.refExact || x.score >= 0.72).sort((a, b) => b.score - a.score);

  if (!candidates.length) return {
    state: 'TALLY NOT FOUND' as const,
    reason: kind === 'SALES'
      ? 'No final Sales accounting row matched SO + party + quantity/date evidence.'
      : 'No final Purchase accounting row matched supplier invoice + vendor + quantity/date evidence.',
    candidates: [] as Array<Record<string, unknown>>,
  };
  if (candidates.length > 1 && Math.abs(candidates[0].score - candidates[1].score) < 0.08) return {
    state: 'NEEDS REVIEW' as const,
    reason: 'Multiple final accounting candidates have similar evidence; no accounting voucher was guessed.',
    candidates: candidates.slice(0, 3).map(x => ({ voucher: x.r._voucherNo, sheet: x.r._sheet, score: Number(x.score.toFixed(3)), party: x.r.Particulars, quantity: x.r._qty, date: x.r._date })),
  };
  const best = candidates[0];
  used.add(`${best.r._sheet}|${best.r._row}`);
  return {
    state: 'TALLY MATCHED' as const,
    match: best.r,
    reason: `Matched final ${kind === 'SALES' ? 'Sales' : 'Purchase'} accounting register using ${kind === 'SALES' ? 'SO' : 'supplier invoice'}, party, quantity and date-window evidence.`,
    candidates: [] as Array<Record<string, unknown>>,
  };
}

function businessCategory(raw?: string) {
  const x = String(raw || '').toUpperCase();
  if (x.includes('INTERNAL')) return 'INNER SHIFT';
  if (x.includes('JOB WORK')) return 'JOB WORK';
  if (x.includes('PURCHASE')) return 'PURCHASE';
  if (x === 'SALES') return 'SALES';
  if (['FIREWOOD', 'WATER', 'STORE MATERIAL', 'JUTE GUNNY BAGS'].includes(x)) return 'OTHER';
  return 'UNCLASSIFIED';
}

export function buildTransactionReconciliationV5(weigh: Row[], gateIn: Row[], gateOut: Row[], book: XLSX.WorkBook) {
  const physical = buildPhysicalSummary(weigh, gateIn, gateOut);
  const accounting = parseAccountingRegisters(book);
  const byWeigh = new Map(physical.matches.map(m => [m.source._row, m]));
  const usedAccounting = new Set<string>();

  const main = weigh.map((w, idx) => {
    const pm = byWeigh.get(w._row), gate = pm?.match, category = businessCategory(pm?.category);
    let tally: { state: string; reason: string; candidates: Array<Record<string, unknown>>; match?: AccountingRow } = {
      state: 'SOURCE INSUFFICIENT', reason: 'ERP/Gate transaction is not resolved, so final accounting cannot be proven.', candidates: [],
    };
    if (gate && pm?.status === 'FOUND' && (category === 'PURCHASE' || category === 'SALES')) {
      tally = accountingMatch(category as 'PURCHASE' | 'SALES', gate, w, accounting, usedAccounting);
    } else if (gate && ['OTHER', 'INNER SHIFT', 'JOB WORK'].includes(category)) {
      tally = { state: 'TALLY NOT REQUIRED', reason: 'This movement category does not require a standard Purchase/Sales accounting voucher.', candidates: [] };
    } else if (gate && pm?.status === 'PROBABLE MATCH') {
      tally = { state: 'NEEDS REVIEW', reason: 'ERP/Gate allocation is ambiguous; Tally matching is intentionally not finalized.', candidates: [] };
    }

    const erpState = !gate ? 'ERP NOT FOUND' : pm?.status === 'PROBABLE MATCH' ? 'NEEDS REVIEW' : 'ERP MATCHED';
    const reconciliationState = erpState === 'ERP NOT FOUND' ? 'ERP Missing'
      : erpState === 'NEEDS REVIEW' || tally.state === 'NEEDS REVIEW' ? 'Needs Review'
      : tally.state === 'TALLY NOT FOUND' ? 'Tally Missing'
      : tally.state === 'SOURCE INSUFFICIENT' ? 'Source Insufficient'
      : tally.state === 'TALLY NOT REQUIRED' ? 'Not Applicable' : 'Reconciled';

    return {
      serialNo: idx + 1,
      lorryNo: w['Vehilce No'] || w['Vehicle No'] || '',
      partyName: w['Party Name'] || gate?.['Supplier Name'] || gate?.['Customer Name'] || '',
      material: w['Material'] || gate?.['Material Name'] || gate?.['Products Name'] || '',
      netWeight: pick(w, 'Net Weight', 'NetWeight', 'Net Wt', 'NetWt') || '',
      weighBridgeRef: w['Serial No'] || w['Weigh Bridge Ref No'] || w['Weigh Bridge Ref NO'] || '',
      erpGpNo: gate?.['GatePass No'] || '',
      tallyRefNo: tally.match?._voucherNo || '',
      status: category,
      reconciliationState,
      erpState,
      tallyState: tally.state,
      weighmentSourceRow: w._row,
      gateSourceRow: gate?._row || null,
      tallySourceRow: tally.match?._row || null,
      matchEvidence: {
        vehicle: gate && canonVehicle(w['Vehilce No'] || w['Vehicle No']) === gate._vehicle ? 'Vehicle Exact' : '',
        party: gate ? `${Math.round(partySimilarity(w['Party Name'], gate._party) * 100)}% party similarity` : '',
        material: gate ? `${Math.round(similarity(canonMaterial(w['Material']), canonMaterial(gate._material)) * 100)}% material similarity` : '',
        accounting: tally.reason,
      },
      candidates: tally.candidates || [],
    };
  });

  const categories = ['PURCHASE', 'SALES', 'OTHER', 'INNER SHIFT', 'JOB WORK', 'UNCLASSIFIED'] as const;
  const categoryCounts: Record<string, number> = Object.fromEntries(categories.map(c => [c, main.filter(r => r.status === c).length]));
  const controls = {
    physicalWeighments: weigh.length,
    generatedMainRecords: main.length,
    missingSourceTransactions: main.filter(r => r.erpState === 'ERP NOT FOUND').length,
    duplicateOutputTransactions: Math.max(0, main.length - new Set(main.map(r => `${r.weighBridgeRef}|${r.weighmentSourceRow}`)).size),
    rowConservation: main.length === weigh.length,
    categoryTotal: Object.values(categoryCounts).reduce((a, b) => a + b, 0),
  };
  return {
    main,
    categories: Object.fromEntries(categories.filter(c => c !== 'UNCLASSIFIED').map(c => [c, main.filter(r => r.status === c)])),
    categoryCounts,
    controls,
    summary: {
      physicalMovements: main.length,
      erpMatched: main.filter(r => r.erpState === 'ERP MATCHED').length,
      tallyMatched: main.filter(r => r.tallyState === 'TALLY MATCHED').length,
      erpMissing: main.filter(r => r.erpState === 'ERP NOT FOUND').length,
      tallyMissing: main.filter(r => r.tallyState === 'TALLY NOT FOUND').length,
      needsReview: main.filter(r => r.reconciliationState === 'Needs Review').length,
      ...categoryCounts,
    },
  };
}

type Allocation = {
  date: string; vendor: string; vendorNormalized: string; paymentVoucher: string; bankReference: string;
  agstRef: string; lotToken: string; actualPaise: number; voucherTotalPaise: number; referenceCount: number;
  row: number; kind: 'AGST REF' | 'ON ACCOUNT';
};
export type VendorAlias = { alias: string; canonical: string };

function bankRef(v: DayBookVoucher) {
  const text = v.lines.map(x => x.particular).join(' | ');
  const m = text.match(/(?:UTR|NEFT|RTGS|CHEQUE|CHE\.?\s*NO\.?|BANK REF)\s*[:#.-]?\s*([A-Z0-9\/-]+)/i);
  return m?.[1] || '';
}
function allocations(book: XLSX.WorkBook): Allocation[] {
  const out: Allocation[] = [];
  for (const v of parseDayBook(book).filter(x => /^PAYMENT$/i.test(x.voucherType.trim()))) {
    const refs = v.references.filter(r => /AGST REF|ON ACCOUNT/i.test(r.kind));
    const voucherTotalPaise = Math.abs(toPaise(v.debit || v.credit));
    if (!refs.length) {
      out.push({ date: v._date || '', vendor: v.party, vendorNormalized: canonParty(v.party), paymentVoucher: v.voucherNo, bankReference: bankRef(v), agstRef: 'On Account', lotToken: '', actualPaise: voucherTotalPaise, voucherTotalPaise, referenceCount: 0, row: v._row, kind: 'ON ACCOUNT' });
      continue;
    }
    for (const r of refs) out.push({
      date: v._date || '', vendor: v.party, vendorNormalized: canonParty(v.party), paymentVoucher: v.voucherNo,
      bankReference: bankRef(v), agstRef: r.reference || r.kind, lotToken: lotToken(r.reference),
      actualPaise: Math.abs(toPaise(r.amount || (refs.length === 1 ? (v.debit || v.credit) : 0))),
      voucherTotalPaise, referenceCount: refs.length, row: r.row,
      kind: /ON ACCOUNT/i.test(r.kind) ? 'ON ACCOUNT' : 'AGST REF',
    });
  }
  return out;
}

function vendorCanonical(v: unknown, aliases: VendorAlias[]) {
  const raw = canonParty(v);
  const hit = aliases.find(a => canonParty(a.alias) === raw);
  return canonParty(hit?.canonical || raw);
}

type FormulaResult =
  | { configured: false; reason: string; purchaseType: string }
  | { configured: true; purchaseType: string; bill: number; gstPercent: number; gst: number; gstUnroundedPaise: number; rebateBase: number; rebateTax: number; fullRebate: number; weigh: number; unloading: number; tds: number; expected: number; documentedAdvance: number; roundingAdjustment: number };

function formula(c: Row, gstPercent = 5): FormulaResult {
  const purchaseType = txt(c.PurchaseType);
  if (/^DIRECT\s+PURCHASE$/i.test(purchaseType)) return { configured: false, reason: 'DIRECT PURCHASE RULE NOT CONFIGURED', purchaseType };
  const bill = toPaise(c.BillValue);
  const gstUnroundedPaise = bill * gstPercent / 100;
  const gst = Math.round(gstUnroundedPaise);
  const rebateBase = toPaise(c['Rebate Value']);
  const rebateNet = toPaise(c['Rebate Net Value']);
  const rebateTax = toPaise(c['Rebate IGST Amount']) + toPaise(c['Rebate CGST Amount']) + toPaise(c['Rebate SGST Amount']);
  const fullRebate = rebateNet || rebateBase + rebateTax;
  const weigh = toPaise(c.Weightment ?? c.Weighment);
  const unloading = toPaise(c.Unloading);
  const tds = toPaise(c.TDS);
  const expected = bill + gst - fullRebate - weigh - unloading - tds;
  return {
    configured: true, purchaseType, bill, gstPercent, gst, gstUnroundedPaise, rebateBase, rebateTax, fullRebate,
    weigh, unloading, tds, expected, documentedAdvance: toPaise(c.Advance), roundingAdjustment: gst - gstUnroundedPaise,
  };
}

export function purchasePaymentReconciliationV5(
  creditRows: Row[], book: XLSX.WorkBook, gstPercent = 5, toleranceRupees = 1, aliases: VendorAlias[] = [],
) {
  const pays = allocations(book), tol = Math.round(toleranceRupees * 100);
  const rows = pays.map((p, i) => {
    if (p.kind === 'ON ACCOUNT' || /ON ACCOUNT/i.test(p.agstRef)) return {
      sequence: i + 1, paymentDate: p.date, vendor: p.vendor, paymentVoucher: p.paymentVoucher, bankReference: p.bankReference,
      dayBookRef: p.agstRef, matchedLot: '', lotSequence: '', actual: rupees(p.actualPaise), expected: null, variance: null,
      status: 'ON ACCOUNT PAYMENT', comment: 'Payment is on account / advance and is not forced to a purchase-lot match.', purchaseType: '', matches: [],
    };

    const lotMatches = creditRows.filter(c => (c._lotCore || lotToken(c.LotNumber)) === p.lotToken);
    const paymentVendorMaster = vendorCanonical(p.vendor, aliases);
    const vendorMatches = lotMatches.filter(c => vendorCanonical(c['Customer Name'], aliases) === paymentVendorMaster);
    let source: Row | undefined, status = '', comment = '';
    if (!lotMatches.length) { status = 'CREDIT/DEBIT RECORD NOT FOUND'; comment = 'Verify whether the supplied Credit/Debit export covers this transaction.'; }
    else if (!vendorMatches.length) { status = 'VENDOR MISMATCH'; comment = 'The lot token exists in the Credit/Debit source but not for the Day Book vendor or a configured vendor alias.'; }
    else if (vendorMatches.length > 1) { status = 'AMBIGUOUS LOT MATCH'; comment = 'More than one purchase row matches this lot and vendor; no row was guessed.'; }
    else source = vendorMatches[0];

    if (!source) return {
      sequence: i + 1, paymentDate: p.date, vendor: p.vendor, paymentVoucher: p.paymentVoucher, bankReference: p.bankReference,
      dayBookRef: p.agstRef, matchedLot: '', lotSequence: p.lotToken, actual: rupees(p.actualPaise), expected: null, variance: null,
      status, comment, purchaseType: '', matches: lotMatches.slice(0, 3).map(c => ({ lot: c.LotNumber, vendor: c['Customer Name'], product: c['Product Name'], invoice: c['Invoice No'] })),
    };

    const calc = formula(source, gstPercent);
    if (!calc.configured) return {
      sequence: i + 1, paymentDate: p.date, vendor: p.vendor, paymentVoucher: p.paymentVoucher, bankReference: p.bankReference,
      dayBookRef: p.agstRef, matchedLot: source.LotNumber, lotSequence: p.lotToken, actual: rupees(p.actualPaise), expected: null, variance: null,
      status: 'RULE REVIEW REQUIRED', comment: calc.reason, purchaseType: calc.purchaseType, source,
    };

    const variance = p.actualPaise - calc.expected;
    let finalStatus = Math.abs(variance) <= tol ? 'MATCHED — CORRECT AMOUNT' : variance > tol ? 'POSSIBLE OVERPAYMENT' : 'POSSIBLE UNDERPAYMENT';
    let finalComment = Math.abs(variance) <= tol
      ? 'Actual payment is within configured tolerance of expected payable.'
      : variance > tol ? 'Actual payment is higher than deterministic expected payable.' : 'Actual payment is lower than deterministic expected payable.';
    if (calc.documentedAdvance) {
      finalStatus = 'NEEDS REVIEW';
      finalComment = 'The source contains an Advance value. It is surfaced as documented evidence but is not auto-applied without a configured adjustment rule.';
    }
    return {
      sequence: i + 1, paymentDate: p.date, vendor: p.vendor, paymentVoucher: p.paymentVoucher, bankReference: p.bankReference,
      dayBookRef: p.agstRef, matchedLot: source.LotNumber, lotSequence: p.lotToken, product: source['Product Name'], purchaseType: calc.purchaseType,
      invoice: source['Invoice No'], billValue: rupees(calc.bill), gst: rupees(calc.gst), rebate: rupees(calc.rebateBase), rebateGst: rupees(calc.rebateTax),
      fullRebate: rupees(calc.fullRebate), weighment: rupees(calc.weigh), unloading: rupees(calc.unloading), tds: rupees(calc.tds),
      documentedAdvance: rupees(calc.documentedAdvance), expected: rupees(calc.expected), actual: rupees(p.actualPaise), variance: rupees(variance),
      roundingAdjustment: rupees(calc.roundingAdjustment), status: finalStatus, comment: finalComment, voucherTotal: rupees(p.voucherTotalPaise), source,
    };
  });

  const voucherControls = Array.from(new Set(pays.map(p => `${p.date}|${p.paymentVoucher}`))).map(k => {
    const group = pays.filter(p => `${p.date}|${p.paymentVoucher}` === k), voucher = group[0];
    const allocated = group.reduce((a, b) => a + b.actualPaise, 0), difference = allocated - voucher.voucherTotalPaise;
    return { paymentDate: voucher.date, paymentVoucher: voucher.paymentVoucher, vendor: voucher.vendor, voucherTotal: rupees(voucher.voucherTotalPaise), allocatedTotal: rupees(allocated), difference: rupees(difference), status: Math.abs(difference) <= 1 ? 'PASS' : 'PAYMENT ALLOCATION CONTROL FAILED' };
  });

  const comparable = rows.filter(r => typeof r.expected === 'number');
  const totalExpected = comparable.reduce((a, r) => a + Number(r.expected || 0), 0);
  const comparableActual = comparable.reduce((a, r) => a + Number(r.actual || 0), 0);
  const totalActual = rows.reduce((a, r) => a + Number(r.actual || 0), 0);
  const summary = {
    purchasePayments: rows.length,
    correct: rows.filter(r => r.status === 'MATCHED — CORRECT AMOUNT').length,
    overpayments: rows.filter(r => r.status === 'POSSIBLE OVERPAYMENT').length,
    underpayments: rows.filter(r => r.status === 'POSSIBLE UNDERPAYMENT').length,
    sourceMissing: rows.filter(r => r.status === 'CREDIT/DEBIT RECORD NOT FOUND').length,
    needsReview: rows.filter(r => ['NEEDS REVIEW', 'AMBIGUOUS LOT MATCH', 'VENDOR MISMATCH', 'RULE REVIEW REQUIRED'].includes(r.status)).length,
    onAccount: rows.filter(r => r.status === 'ON ACCOUNT PAYMENT').length,
    totalExpected, totalActual, comparableActual, netVariance: comparableActual - totalExpected,
    eligiblePurchasePaymentAllocations: rows.length,
    voucherControlFailures: voucherControls.filter(v => v.status !== 'PASS').length,
  };
  return { rows, voucherControls, summary };
}
