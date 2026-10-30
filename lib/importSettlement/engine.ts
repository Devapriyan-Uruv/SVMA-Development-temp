import { nameSimilarity } from '@/lib/reconciliation/normalize';
import type { DayBookVoucher } from '@/lib/outstanding/engine';

// Import Settlement sheet — one row per invoice / Bill of Entry, filled from three places (the sheet's own notes):
//   • the contract and invoice (cols 1-8, 27-29)            → typed / extracted
//   • the Tally Day Book, found through the BOE number      → expenses 9-26 (except 12), settlement 30-34 and 36
//   • the Bill of Entry (cols 12, 35) and formulas (37-42)  • the ERP receipts → the load-wise block
// Nothing is guessed silently: every figure keeps the vouchers behind it, a Day Book line without the BOE / invoice / contract number
// on it is only a *candidate* until the person confirms it, and any figure can be typed over.

export type Invoice = { id: string; invNo: string; invQty: number | null; ratePerTon: number | null; invValueUsd: number | null; advPaidUsd: number | null; boeNo: string | null; boeDate: string | null; assessableValue: number | null };
export type ContractLite = { contractNumber: string; supplierName: string; product: string; quantity: number | null; uom: string | null; unitPrice: number | null; currency: string | null; contractDate: string | null; shipmentEnd: string | null; erpSupplier: string | null; erpProduct: string | null };
export type VoucherRow = { vkey: string; voucher: DayBookVoucher };
export type Receipt = { rnNo: string; rnDate: string; vehicleNo: string; supplier: string; product: string; qty: number; freightAmt: number; billValue: number; poNo: string };
export type Link = { kind: 'tally' | 'erp'; refKey: string; colKey: string | null; status: 'confirmed' | 'excluded' };
export type Override = { invoiceId: string | null; colKey: string; value: number | null };

export type ColKey = 'insurance' | 'bankChgs' | 'duty' | 'igst' | 'dutyInterest' | 'linerFees' | 'pqFees' | 'cfs' | 'chaFees' | 'fssai' | 'handCharges' | 'surveyor' | 'demurrage' | 'freight' | 'comFees';
export const EXPENSE_COLS: { key: ColKey; no: number; label: string; re: RegExp }[] = [
  { key: 'insurance', no: 9, label: 'Insurance', re: /insurance/i },
  { key: 'bankChgs', no: 11, label: 'Bank charges', re: /bank\s*(charges|chgs?)|\blc\s*(charges|commission|opening)|bill\s*collection|swift|forex\s*(commission|charges)/i },
  { key: 'duty', no: 13, label: 'Duty', re: /(customs?|import)\s*duty|\bbcd\b|basic\s*customs|\bsws\b|duty\s*a\/c|customs/i },
  { key: 'igst', no: 14, label: 'IGST', re: /igst/i },
  { key: 'dutyInterest', no: 15, label: 'Duty interest', re: /(duty|customs)\s*interest|interest\s*on\s*(duty|customs)/i },
  { key: 'linerFees', no: 16, label: 'Liner fees', re: /liner|shipping\s*line|\bthc\b|\bd\.?o\.?\s*charges|delivery\s*order/i },
  { key: 'pqFees', no: 17, label: 'PQ fees', re: /\bpq\b|plant\s*quarantine|quarantine/i },
  { key: 'cfs', no: 18, label: 'CFS', re: /\bcfs\b|container\s*freight\s*station/i },
  { key: 'chaFees', no: 19, label: 'CHA fees', re: /\bcha\b|clearing|custom\s*house\s*agent|forwarding/i },
  { key: 'fssai', no: 20, label: 'FSSAI', re: /fssai/i },
  { key: 'handCharges', no: 21, label: 'Hand charges', re: /hand(l)?ing|hamali|loading\s*charges|unloading/i },
  { key: 'surveyor', no: 22, label: 'Surveyor', re: /survey/i },
  { key: 'demurrage', no: 23, label: 'Demurrage', re: /demurr?age|detention/i },
  { key: 'freight', no: 24, label: 'Freight', re: /freight|transport|lorry|logistics/i },
  { key: 'comFees', no: 25, label: 'Commission', re: /commission|brokerage/i },
];
/** TOT.VALUE (col 26) adds every expense except IGST (recoverable credit) — checked against the sample sheet: 532,723 = the twelve non-IGST amounts. */
export const TOTAL_EXP_KEYS = EXPENSE_COLS.filter(c => c.key !== 'igst').map(c => c.key);
export const SETTLE_COLS = [{ key: 'purchaseValue', label: 'Purchase value (col 36)' }, { key: 'advPaidInr', label: 'Advance paid INR (col 33)' }, { key: 'balanceInr', label: 'Balance paid INR (col 34)' }] as const;
export const ASSIGNABLE = [...EXPENSE_COLS.map(c => ({ key: c.key as string, label: c.label })), ...SETTLE_COLS.map(c => ({ key: c.key as string, label: c.label }))];

export type Suggestion = {
  key: string; vkey: string; date: string; vchType: string; vchNo: string; ledger: string; amount: number; narration: string;
  colKey: string | null; section: 'expense' | 'purchase' | 'payment'; evidence: string[];
  status: 'auto' | 'candidate' | 'confirmed' | 'excluded'; invoiceId: string | null;
};
export type Cell = { value: number | string | null; source: 'contract' | 'tally' | 'boe' | 'formula' | 'manual' | 'blank'; refs?: string[] };
export type SheetRow = { invoiceId: string; invNo: string; cells: Record<string, Cell> };
export type LoadRow = { rnNo: string; date: string; vehicleNo: string; loadingTon: Cell; lfPerTon: Cell; totFreight: Cell; purValue: Cell };
export type LoadSuggestion = { rnNo: string; date: string; vehicleNo: string; supplier: string; product: string; qty: number; poNo: string; status: 'suggested' | 'confirmed' | 'excluded'; score: number };

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const norm = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const BANK_OR_CASH = /\bbank\b|\bcash\b|\bcc\s*a\/?c\b|hdfc|sbi\b|icici|axis|canara|\bcc\b|petty/i;
const dayMs = 86400000;
const t = (d: string | null | undefined) => (d ? Date.parse(d) : NaN);

/** The voucher's searchable text: ledger names, bill references and narration. */
const textOf = (v: DayBookVoucher) => [...v.lines.map(l => l.name), ...v.lines.flatMap(l => l.refs.map(r => r.ref)), ...v.narration].join(' | ');

export type EngineInput = {
  contract: ContractLite; invoices: Invoice[]; vouchers: VoucherRow[]; receipts: Receipt[];
  links: Link[]; overrides: Override[]; today?: string;
};
export type Settlement = {
  header: { contractNo: string; party: string; commodity: string; contractQty: string; ratePerTon: string };
  rows: SheetRow[]; totals: Record<string, number>;
  perTon: { partyAmount: Cell; totalExp: Cell; receivedTons: Cell; perTonCost: Cell };
  loads: LoadRow[]; loadTotals: { tons: number; freight: number; purValue: number };
  suggestions: Suggestion[]; loadSuggestions: LoadSuggestion[]; notes: string[];
};

export function buildSettlement(inp: EngineInput): Settlement {
  const { contract, invoices, vouchers, receipts, links, overrides } = inp;
  const notes: string[] = [];
  const linkOf = new Map(links.map(l => [`${l.kind}|${l.refKey}`, l]));
  const ovr = (invoiceId: string | null, key: string) => overrides.find(o => o.colKey === key && (o.invoiceId === invoiceId || (o.invoiceId == null && invoiceId == null)));
  const boeNeedles = invoices.map(i => ({ id: i.id, boe: (i.boeNo || '').replace(/\D/g, ''), inv: norm(i.invNo) }));
  const contractNeedle = norm(contract.contractNumber);
  const firstInvoice = invoices[0]?.id ?? null;
  const windowFrom = Math.min(...[t(contract.contractDate), ...invoices.map(i => t(i.boeDate) - 45 * dayMs)].filter(Number.isFinite), Date.now());
  const boeDates = invoices.map(i => t(i.boeDate)).filter(Number.isFinite);

  // ---- 1. Day Book: expense lines, purchase voucher and payments to the party
  const suggestions: Suggestion[] = [];
  const supplierNames = [contract.supplierName, contract.erpSupplier].filter(Boolean) as string[];
  const partyScore = (name: string) => Math.max(0, ...supplierNames.map(s => nameSimilarity(s, name)));
  for (const { vkey, voucher: v } of vouchers) {
    const text = textOf(v), N = norm(text);
    const evidence: string[] = []; let invoiceId: string | null = null;
    for (const n of boeNeedles) {
      if (n.boe.length >= 6 && text.replace(/\D/g, '').includes(n.boe)) { evidence.push(`BOE ${n.boe}`); invoiceId = n.id; break; }
      if (n.inv.length >= 4 && N.includes(n.inv)) { evidence.push(`invoice ${n.inv}`); invoiceId = n.id; break; }
    }
    if (!evidence.length && contractNeedle.length >= 5 && N.includes(contractNeedle)) evidence.push(`contract ${contract.contractNumber}`);
    const strong = evidence.length > 0, dateMs = t(v.date);
    const inWindow = Number.isFinite(dateMs) && dateMs >= windowFrom - 30 * dayMs && (!boeDates.length || dateMs <= Math.max(...boeDates) + 60 * dayMs);
    const type = v.vchType.toLowerCase();
    v.lines.forEach((l, idx) => {
      const key = `${vkey}|${idx}`;
      const amountOf = (n: number | null) => (n && n > 0 ? n : 0);
      const push = (section: Suggestion['section'], colKey: string | null, amount: number, ev: string[], base: Suggestion['status']) => {
        const link = linkOf.get(`tally|${key}`);
        const status: Suggestion['status'] = link ? (link.status === 'excluded' ? 'excluded' : 'confirmed') : base;
        suggestions.push({ key, vkey, date: v.date, vchType: v.vchType, vchNo: v.vchNo, ledger: l.name, amount, narration: v.narration.join(' ').slice(0, 160), colKey: link?.colKey || colKey, section, evidence: ev, status, invoiceId: invoiceId || firstInvoice });
      };
      // purchase voucher of the supplier
      if (/purchase/i.test(type) && partyScore(l.name) >= 0.7 && amountOf(l.cr)) { if (strong || inWindow) push('purchase', 'purchaseValue', amountOf(l.cr), [`supplier ${l.name}`, ...evidence], strong ? 'auto' : 'candidate'); return; }
      // payment to the supplier (advance before the purchase / BOE, balance after)
      if (/payment/i.test(type) && partyScore(l.name) >= 0.7 && amountOf(l.dr)) { if (strong || inWindow) push('payment', null, amountOf(l.dr), [`supplier ${l.name}`, ...evidence], strong ? 'auto' : 'candidate'); return; }
      // expense ledgers
      if (amountOf(l.dr)) {
        // "Bank Charges" is an expense although the word bank is in it; a plain bank / cash ledger matches no expense column and is skipped.
        const col = EXPENSE_COLS.find(c => c.re.test(l.name) && !(c.key === 'duty' && /interest/i.test(l.name)));
        const linked = linkOf.get(`tally|${key}`);
        if (col && (strong || inWindow || linked)) push('expense', col.key, amountOf(l.dr), strong ? evidence : ['within the shipment window — no BOE / invoice number on it'], strong ? 'auto' : 'candidate');
        else if (!col && !BANK_OR_CASH.test(l.name) && strong && /duty|igst|charges|fees|freight/i.test(l.name)) push('expense', null, amountOf(l.dr), evidence, 'candidate');
      }
    });
  }
  // advance vs balance for payments: before the purchase voucher (or first BOE) = advance
  const purchaseDates = suggestions.filter(s => s.section === 'purchase' && s.status !== 'excluded').map(s => t(s.date)).filter(Number.isFinite);
  const cutoff = purchaseDates.length ? Math.min(...purchaseDates) : boeDates.length ? Math.min(...boeDates) : NaN;
  for (const s of suggestions) if (s.section === 'payment' && !linkOf.get(`tally|${s.key}`)?.colKey) s.colKey = Number.isFinite(cutoff) && t(s.date) < cutoff ? 'advPaidInr' : 'balanceInr';
  const counted = (s: Suggestion) => s.status === 'auto' || s.status === 'confirmed';

  // ---- 2. Sheet rows
  const rows: SheetRow[] = invoices.map(inv => {
    const cells: Record<string, Cell> = {};
    const manual = (key: string, c: Cell): Cell => { const o = ovr(inv.id, key); return o && o.value != null ? { value: o.value, source: 'manual' } : c; };
    const num = (key: string, v: number | null, source: Cell['source']) => (cells[key] = manual(key, v == null ? { value: null, source: 'blank' } : { value: v, source }));
    const sum = (key: string) => { const m = suggestions.filter(s => counted(s) && s.colKey === key && s.invoiceId === inv.id); return { v: m.length ? round(m.reduce((a, s) => a + s.amount, 0)) : null, refs: m.map(s => s.key) }; };
    const tally = (key: string) => { const x = sum(key); cells[key] = manual(key, x.v == null ? { value: null, source: 'blank' } : { value: x.v, source: 'tally', refs: x.refs }); return cells[key].value as number | null; };
    cells.invNo = { value: inv.invNo, source: 'contract' };
    num('invQty', inv.invQty, 'contract'); num('ratePerTon', inv.ratePerTon ?? contract.unitPrice, 'contract');
    for (const c of EXPENSE_COLS) tally(c.key);
    const purchase = tally('purchaseValue');
    cells.invValueInr = manual('invValueInr', purchase == null ? { value: null, source: 'blank' } : { value: purchase, source: 'tally', refs: cells.purchaseValue.refs });
    cells.boeNo = { value: inv.boeNo, source: inv.boeNo ? 'boe' : 'blank' };
    const totExp = round(TOTAL_EXP_KEYS.reduce((a, k) => a + Number(cells[k].value ?? 0), 0));
    cells.totValue = manual('totValue', { value: totExp, source: 'formula' });
    const usd = inv.invValueUsd ?? (inv.invQty != null && (inv.ratePerTon ?? contract.unitPrice) != null ? round(inv.invQty * Number(inv.ratePerTon ?? contract.unitPrice)) : null);
    num('invValueUsd', usd, 'contract'); num('advPaidUsd', inv.advPaidUsd, 'contract');
    cells.balanceUsd = manual('balanceUsd', usd == null ? { value: null, source: 'blank' } : { value: round(usd - Number(inv.advPaidUsd ?? 0)), source: 'formula' });
    tally('advPaidInr'); tally('balanceInr');
    num('assValue', inv.assessableValue, 'boe');
    const setVal = round(Number(cells.advPaidInr.value ?? 0) + Number(cells.balanceInr.value ?? 0));
    cells.setValue = manual('setValue', cells.advPaidInr.value == null && cells.balanceInr.value == null ? { value: null, source: 'blank' } : { value: setVal, source: 'formula' });
    cells.diffValue = manual('diffValue', cells.purchaseValue.value == null || cells.setValue.value == null ? { value: null, source: 'blank' } : { value: round(Number(cells.purchaseValue.value) - Number(cells.setValue.value)), source: 'formula' });
    return { invoiceId: inv.id, invNo: inv.invNo, cells };
  });
  const totals: Record<string, number> = {};
  for (const k of ['invQty', ...EXPENSE_COLS.map(c => c.key), 'totValue', 'invValueUsd', 'advPaidUsd', 'balanceUsd', 'advPaidInr', 'balanceInr', 'assValue', 'purchaseValue', 'setValue', 'diffValue']) totals[k] = round(rows.reduce((a, r) => a + Number(r.cells[k]?.value ?? 0), 0), k === 'invQty' ? 3 : 2);

  // ---- 3. ERP receipts: suggestions to confirm, confirmed ones become the load-wise block
  const loadSuggestions: LoadSuggestion[] = [];
  const prodNames = [contract.product, contract.erpProduct].filter(Boolean) as string[];
  const from = Math.min(t(contract.contractDate) || Date.now(), ...boeDates.map(d => d - 60 * dayMs));
  for (const r of receipts) {
    const link = linkOf.get(`erp|${r.rnNo}`);
    const sup = Math.max(0, ...supplierNames.map(s => nameSimilarity(s, r.supplier))), prod = prodNames.length ? Math.max(0, ...prodNames.map(p => nameSimilarity(p, r.product))) : 0.5;
    const dateOk = Number.isFinite(t(r.rnDate)) && t(r.rnDate) >= from - 15 * dayMs;
    if (!link && !(sup >= 0.6 && prod >= 0.5 && dateOk)) continue;
    loadSuggestions.push({ rnNo: r.rnNo, date: r.rnDate, vehicleNo: r.vehicleNo, supplier: r.supplier, product: r.product, qty: r.qty, poNo: r.poNo, status: link ? (link.status === 'excluded' ? 'excluded' : 'confirmed') : 'suggested', score: round((sup + prod) / 2, 2) });
  }
  loadSuggestions.sort((a, b) => a.date.localeCompare(b.date) || a.rnNo.localeCompare(b.rnNo));
  const confirmed = receipts.filter(r => loadSuggestions.find(s => s.rnNo === r.rnNo)?.status === 'confirmed').sort((a, b) => a.rnDate.localeCompare(b.rnDate));
  const receivedTons = round(confirmed.reduce((a, r) => a + r.qty, 0), 3);
  const purchaseTotal = totals.purchaseValue || null;
  const loads: LoadRow[] = confirmed.map(r => {
    const pick = (field: string, auto: Cell): Cell => { const o = ovr(null, `load:${r.rnNo}:${field}`); return o && o.value != null ? { value: o.value, source: 'manual' } : auto; };
    const lf = r.qty > 0 && r.freightAmt > 0 ? round(r.freightAmt / r.qty) : null;
    const lfCell = pick('lfPerTon', lf == null ? { value: null, source: 'blank' } : { value: lf, source: 'tally' });
    const freight = pick('totFreight', lfCell.value != null ? { value: round(Number(lfCell.value) * r.qty, 0), source: 'formula' } : r.freightAmt > 0 ? { value: r.freightAmt, source: 'tally' } : { value: null, source: 'blank' });
    const pv = purchaseTotal != null && receivedTons > 0 ? round(r.qty * (purchaseTotal / receivedTons), 0) : null;
    return { rnNo: r.rnNo, date: r.rnDate, vehicleNo: r.vehicleNo, loadingTon: { value: round(r.qty, 3), source: 'tally' }, lfPerTon: lfCell, totFreight: freight, purValue: pick('purValue', pv == null ? { value: null, source: 'blank' } : { value: pv, source: 'formula' }) };
  });
  const loadTotals = { tons: receivedTons, freight: round(loads.reduce((a, l) => a + Number(l.totFreight.value ?? 0), 0)), purValue: round(loads.reduce((a, l) => a + Number(l.purValue.value ?? 0), 0)) };

  // ---- 4. Per-ton cost: (party amount + total expenses) ÷ received tons
  const mCell = (k: string, c: Cell): Cell => { const o = ovr(null, k); return o && o.value != null ? { value: o.value, source: 'manual' } : c; };
  const partyAmount = mCell('partyAmount', totals.setValue ? { value: totals.setValue, source: 'formula' } : { value: null, source: 'blank' });
  const totalExp = mCell('totalExp', { value: totals.totValue, source: 'formula' });
  const recv = mCell('receivedTons', receivedTons ? { value: receivedTons, source: 'tally' } : { value: null, source: 'blank' });
  const ptc = mCell('perTonCost', partyAmount.value != null && recv.value ? { value: round((Number(partyAmount.value) + Number(totalExp.value ?? 0)) / Number(recv.value)), source: 'formula' } : { value: null, source: 'blank' });

  const invQty = totals.invQty;
  if (receivedTons && invQty && Math.abs(receivedTons - invQty) > 0.0005) notes.push(`Received ${receivedTons} MT against ${invQty} MT invoiced — ${receivedTons > invQty ? 'excess' : 'short'} by ${round(Math.abs(receivedTons - invQty), 3)} MT.`);
  const open = suggestions.filter(s => s.status === 'candidate').length;
  if (open) notes.push(`${open} Day Book line(s) look related but carry no BOE / invoice / contract number — confirm or exclude them below.`);
  if (!invoices.some(i => i.boeNo)) notes.push('Enter the Bill of Entry number on each invoice — the Day Book is matched to the contract through it.');
  const sheetQty = contract.quantity != null ? `${contract.quantity}${contract.uom ? ' ' + contract.uom : ''}` : '';
  return {
    header: { contractNo: contract.contractNumber, party: contract.supplierName, commodity: contract.product, contractQty: sheetQty, ratePerTon: contract.unitPrice != null ? `${contract.unitPrice}${contract.currency ? ' ' + contract.currency : ''}` : '' },
    rows, totals, perTon: { partyAmount, totalExp, receivedTons: recv, perTonCost: ptc }, loads, loadTotals,
    suggestions: suggestions.sort((a, b) => a.date.localeCompare(b.date)), loadSuggestions, notes,
  };
}

/** Best-effort end date of a free-text shipment period ("15-30 Oct 2026", "Oct/Nov 2026", "by 30.09.2026"); null when unclear. */
export function parseShipmentEnd(text: string | null | undefined): string | null {
  const s = String(text || ''); if (!s.trim()) return null;
  const ymd = [...s.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)].pop();
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  const dmy = [...s.matchAll(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/g)].pop();
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const year = (s.match(/\b(20\d{2})\b/) || [])[1]; if (!year) return null;
  const hits = [...s.toLowerCase().matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/g)].map(m => months.indexOf(m[1]));
  if (!hits.length) return null;
  const m = hits[hits.length - 1], day = (s.match(/(\d{1,2})(?:st|nd|rd|th)?\s*(?:[-–]|to)?\s*(\d{1,2})(?:st|nd|rd|th)?\s+[A-Za-z]{3}/) || [])[2];
  const last = new Date(Date.UTC(Number(year), m + 1, 0)).getUTCDate();
  return `${year}-${String(m + 1).padStart(2, '0')}-${String(Math.min(Number(day) || last, last)).padStart(2, '0')}`;
}
