import { text } from '@/lib/reconciliation/normalize';
import type { Gate, TallyVoucher, WeighmentWithLot } from './parsers';
import type { ProductMatch } from './productMaster';
import { isGroupParty, PURCHASE_BY_NATURE_REASON, type Category } from './classification';
import type { CdnRec, LotRec, Prov, ReceiptRec, SalesInvoiceRec, SettlementRec } from './records';
import type { Evidence } from './evidence';
import { NA, NOT_FOUND, pickPrimary, type AuditEntry, type MasterRow, type ReconStatus } from './master';
import { computeQcOil, isQcOilApplicable } from './qcOil';
import { SALES_FIELD_KEYS, salesDebtorFields } from './salesDebtors';
import { invoiceMatches, splitCompositeRef, type LedgerIndex, type RangePayment, type TallyLedgerVoucher, type TallyRef } from './tallyLedger';
import { nameSimilarity, normalizeVehicle } from '@/lib/reconciliation/normalize';

// Tolerances — applied only when BOTH sides of a comparison exist. Kept as
// named constants (and echoed into every export's Definitions sheet) so
// Finance can see exactly what "mismatch" means.
export const QTY_TOLERANCE_MT = 0.05, QTY_TOLERANCE_PCT = 0.005, AMOUNT_TOLERANCE = 1;
// Bag weights. Verified against the September data: the ERP receipt weight is the weighbridge net less 1 kg per jute bag
// (and, for the products that carry plastic bags, 0.2 kg per plastic bag); the Credit/Debit Note's Final Weight is the net
// less jute only. SETTLEMENT_WEIGHT_TOLERANCE_MT is how far a Final Weight may drift before it is called out.
export const JUTE_KG_PER_BAG = 1, PLASTIC_KG_PER_BAG = 0.2, SETTLEMENT_WEIGHT_TOLERANCE_MT = 0.01, PARTY_NAME_FLAG_BELOW = 0.55;
// A normalised Indian vehicle number, e.g. TN30BF6046, TN60J8712, KA01AB1234 (state, district, 0-3 series letters, 4 digits).
const VEHICLE_FORMAT = /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$/;

const up = (s: unknown) => String(s ?? '').trim().toUpperCase();
const MT = (kg: number | null) => (kg == null ? null : Number((kg / 1000).toFixed(4)));
const inr = (n: number) => `₹${Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const val = <T,>(v: T | null | undefined, empty: string = NOT_FOUND): T | string => (v === null || v === undefined || (typeof v === 'string' && !v.trim()) ? empty : v);

export type LotResolution = { lotNo: string | null; source: 'file_resolved' | 'weighment_bridge' | 'ambiguous' | 'file_unresolved' | 'weight_reassigned' | 'none'; confidence: number; rec: LotRec | null; bridgeProv: Prov | null; note?: string };

export type BuildCtx = {
  runId: string; seq: number; date: string;
  w: WeighmentWithLot; product: ProductMatch; gateProduct: ProductMatch | null;
  category: Category; categoryReason: string;
  gate: Gate | null; gateScore: number; gateEvidence: string[];
  lot: LotResolution;
  // Set when several weighments (split loads of one lot/invoice) share one ERP record: totals are compared instead of a single load.
  /** ERP records already accounted for by another weighment whose quantity fits exactly. */
  excludeErp?: Set<string>;
  group?: { size: number; netKg: number; tallyAmount: number | null };
  /** Gunny rate (Rs/bag) charged on a supplier's other lots in this run, keyed by normalised supplier name. */
  gunnyRates?: Map<string, { rate: number; lots: number }>;
  /** Tally purchase vouchers that are not goods lots (maintenance, store material, services...) — the bills of non-stock transactions — and a memoised party-name similarity. */
  nonStockVouchers?: TallyLedgerVoucher[]; partySim?: (a: string, b: string) => number;
  /** Upper-case names of the Tally water suppliers that some weighbridge name already matches. */
  claimedSuppliers?: Set<string>;
  /** Upper-case Tally voucher numbers that belong to ANOTHER weighment (it is linked to the voucher's own ERP document); this one must not share them. */
  excludeTally?: Set<string>;
  evidence: Evidence; ledger: LedgerIndex; tallyVouchers: TallyVoucher[]; bookingScore: (w: WeighmentWithLot, gate: Gate | null, category: Category) => { v: TallyVoucher; score: number; evidence: string[] } | null;
};

export function buildMasterRow(ctx: BuildCtx): MasterRow {
  const { runId, w, product, gate, lot, evidence, ledger } = ctx;
  const reconId = `ONE-${ctx.date.replace(/-/g, '')}-${String(ctx.seq).padStart(4, '0')}`;
  // `type` is the CATEGORY every rule below keys off (Purchase/Sales/...). The Direct/Indirect
  // split of Purchase is display-only, resolved from the Credit/Debit Note further down.
  const type = ctx.category === 'Inter/Job Work' ? 'Inter/Job Work' : ctx.category;
  const audit: AuditEntry[] = [];
  const conf: number[] = [];
  const methods: string[] = [];
  const notes: string[] = [];
  const statuses: ReconStatus[] = [];

  const add = (stage: string, field: string, raw: unknown, normalized: unknown, prov: { origin: AuditEntry['origin']; file: string; sheet: string; row: string }, rule: string, confidence: number) =>
    audit.push({ stage, field, rawValue: String(raw ?? ''), normalizedValue: String(normalized ?? ''), origin: prov.origin, sourceFile: prov.file, sourceSheet: prov.sheet, sourceRow: prov.row, rule, confidence, runId });

  // ---- Weighment / Gate ---------------------------------------------------
  const wProv = { origin: 'upload' as const, file: w.source.file, sheet: w.source.sheet, row: String(w.source.row) };
  add('Weighment', 'Vehicle', w.vehicle, normalizeVehicle(w.vehicle), wProv, 'Read from Weighment Register', 1);
  add('Weighment', 'Material', w.material, product.normalized, wProv, 'Read from Weighment Register', 1);
  add('Weighment', 'Net Weight (kg)', w.weight ?? '', w.weight ?? '', wProv, 'Read from Weighment Register', 1);
  add('Product Master', 'Product', product.raw, product.masterProductName ?? NOT_FOUND, { origin: 'derived', file: 'Product Master (ops_product_master)', sheet: 'ops_product_master', row: product.masterProductId ? `id ${product.masterProductId}` : '—' }, `Product match: ${product.matchMethod}`, product.matchConfidence);
  conf.push(product.matchMethod === 'not_found' ? 0 : product.matchConfidence);
  methods.push(`Product: ${product.matchMethod}`);

  const po = gate?.direction === 'IN' ? gate.order : '', so = gate?.direction === 'OUT' ? gate.order : '';
  const supplierInvoice = /^0*$/.test((gate?.invoice || '').trim()) ? '' : (gate?.invoice || '').trim();
  if (gate) {
    const gProv = { origin: 'upload' as const, file: gate.source.file, sheet: gate.source.sheet, row: String(gate.source.row) };
    add('Gate', 'Gate Pass', gate.gp, gate.gp, gProv, `Gate candidate scoring: ${ctx.gateEvidence.join(', ') || 'vehicle match'}`, ctx.gateScore / 100);
    if (po) add('Gate', 'PO', gate.order, up(gate.order), gProv, 'Purchase Order on Gate In', 1);
    if (so) add('Gate', 'SO', gate.order, up(gate.order), gProv, 'Sales Order on Gate Out', 1);
    if (supplierInvoice) add('Gate', 'Supplier Invoice', gate.invoice, supplierInvoice, gProv, 'Invoice Number on Gate Entry', 1);
    conf.push(ctx.gateScore / 100); methods.push(`Gate: vehicle+material+party (score ${ctx.gateScore.toFixed(0)})`);
  }

  // ---- Lot ----------------------------------------------------------------
  let lotNo = lot.lotNo;
  if (lotNo && lot.rec) { add('Lot', 'Lot Number', w.lot || '(via Time Office bridge)', lotNo, lot.rec.prov, lot.source === 'weight_reassigned' ? (lot.note || 'Lot reassigned by weight') : lot.source === 'weighment_bridge' ? 'Gate pass -> Time Office lot' : 'Weighment lot matched to Operations lot on "/" segment', lot.confidence); conf.push(lot.confidence); methods.push(`Lot: ${lot.source === 'weight_reassigned' ? 'reassigned by weight' : lot.source === 'weighment_bridge' ? 'Time Office bridge' : 'segment match'}`); }
  if (lot.source === 'weight_reassigned' && lot.note) notes.push(lot.note);
  if (lot.source === 'ambiguous') { statuses.push('REVIEW REQUIRED'); notes.push(`Weighment Lot "${w.lot}" matches several lots (same serial under different products) and could not be narrowed by Time Office, PO or Product Master.`); }
  if (lot.source === 'file_unresolved') notes.push(`Weighment Lot "${w.lot}" was not found among uploaded or Operations lots.`);

  const isPurchase = type === 'Purchase', isSales = type === 'Sales';
  const isRaw = product.masterProductType === 'raw_material';
  const oilApplicable = isQcOilApplicable(product.masterCategory);

  // ---- ERP ----------------------------------------------------------------
  let receipt: ReceiptRec | null = null, invoice: SalesInvoiceRec | null = null;
  if (type !== 'Sales' && type !== 'Others') {
    let cands: ReceiptRec[] = lotNo ? evidence.receiptsByLot.get(up(lotNo)) || [] : [];
    if (!cands.length && po) cands = (evidence.receiptsByPo.get(up(po)) || []).filter(r => (supplierInvoice && invoiceMatches(r.billNo, supplierInvoice)) || (r.vehicle && normalizeVehicle(r.vehicle) === normalizeVehicle(w.vehicle)));
    if (cands.length > 1) { const byInv = cands.filter(r => supplierInvoice && invoiceMatches(r.billNo, supplierInvoice)); const byVeh = cands.filter(r => normalizeVehicle(r.vehicle) === normalizeVehicle(w.vehicle)); cands = byInv.length === 1 ? byInv : byVeh.length === 1 ? byVeh : cands; }
    const taken = cands.filter(r => ctx.excludeErp?.has(up(r.rnNo)));
    if (taken.length) { cands = cands.filter(r => !ctx.excludeErp?.has(up(r.rnNo))); notes.push(`ERP receipt ${taken[0].rnNo} is already accounted for by another weighment whose quantity matches it; this load has no ERP receipt of its own.`); }
    if (cands.length === 1) receipt = cands[0];
    else if (cands.length > 1) { statuses.push('REVIEW REQUIRED'); notes.push(`${cands.length} ERP purchase receipts match this lot/PO and could not be narrowed by invoice or vehicle.`); }
  }
  let invoiceHow = '';
  if (type === 'Sales' || type === 'Inter/Job Work') {
    // A job-work invoice (JW...) counts bags in "Quantity MT/No's"; its weight is the kg column.
    const effQty = (r: SalesInvoiceRec): number | null => (/^JW/i.test(r.invoiceNo) && r.qtyKg != null ? r.qtyKg / 1000 : r.qtyMt);
    const lineSum = (a: SalesInvoiceRec[], k: 'amount' | 'taxAmount') => a.every(r => r[k] == null) ? null : a.reduce((t, r) => t + (r[k] ?? 0), 0);
    // A register lists one row per invoice LINE: lines of one invoice are one invoice (quantities/amounts summed; the invoice total is repeated per line, so it is not summed).
    const oneInvoice = (lines: SalesInvoiceRec[]): SalesInvoiceRec => ({ ...lines[0], qtyMt: lines.every(r => effQty(r) == null) ? null : lines.reduce((t, r) => t + (effQty(r) ?? 0), 0), qtyKg: null, amount: lineSum(lines, 'amount'), taxAmount: lineSum(lines, 'taxAmount') });
    const perInvoice = (a: SalesInvoiceRec[]): SalesInvoiceRec[] => { const m = new Map<string, SalesInvoiceRec[]>(); for (const r of a) (m.get(up(r.invoiceNo)) || m.set(up(r.invoiceNo), []).get(up(r.invoiceNo))!).push(r); return [...m.values()].map(oneInvoice); };
    const combine = (list: SalesInvoiceRec[]): SalesInvoiceRec => list.length === 1 ? list[0] : {
      ...list[0], invoiceNo: list.map(r => r.invoiceNo).join(' + '), qtyMt: list.reduce((t, r) => t + (r.qtyMt ?? 0), 0), amount: list.reduce((t, r) => t + (r.amount ?? 0), 0), taxAmount: list.reduce((t, r) => t + (r.taxAmount ?? 0), 0),
      totalInvoiceAmount: list.reduce((t, r) => t + (r.totalInvoiceAmount ?? 0), 0), party: [...new Set(list.map(r => r.party))].join(' / '), parts: list,
    };
    const byNo = supplierInvoice ? evidence.salesInvoiceByNo.get(up(supplierInvoice)) || [] : [];
    let cands = byNo.length ? byNo : so ? evidence.salesInvoicesBySo.get(up(so)) || [] : [];
    const takenInv = cands.filter(r => ctx.excludeErp?.has(up(r.invoiceNo)));
    if (takenInv.length) { cands = cands.filter(r => !ctx.excludeErp?.has(up(r.invoiceNo))); notes.push(`ERP invoice ${takenInv[0].invoiceNo} is already accounted for by another weighment whose quantity matches it; this load has no ERP invoice of its own.`); }
    const distinct = (a: SalesInvoiceRec[]) => new Set(a.map(r => up(r.invoiceNo))).size;
    if (distinct(cands) > 1) { const dt = (d: string) => Math.abs(Date.parse(d) - Date.parse(ctx.date)) <= 86400000; const f = cands.filter(r => normalizeVehicle(r.vehicle) === normalizeVehicle(w.vehicle) && dt(r.date)); cands = f.length ? f : cands.filter(r => normalizeVehicle(r.vehicle) === normalizeVehicle(w.vehicle)); }
    if (cands.length && distinct(cands) === 1 && new Set(cands.map(r => up(r.product))).size === 1) { invoice = oneInvoice(cands); invoiceHow = supplierInvoice ? 'gate invoice number' : 'SO + vehicle/date'; }
    else if (cands.length > 1) { statuses.push('REVIEW REQUIRED'); notes.push(`${cands.length} ERP sales invoices match this SO and could not be narrowed by vehicle/date.`); }

    // The gate record does not always carry the invoice (or carries a different truck's). The weighment itself identifies it:
    // same vehicle, same day, same weight — and one truck can carry several invoices (two parties, one weighment).
    const netMtInv = MT(w.weight);
    const tolInv = Math.max(QTY_TOLERANCE_MT, QTY_TOLERANCE_PCT * (netMtInv ?? 0));
    const fits = (q: number | null) => q != null && netMtInv != null && netMtInv > 0 && Math.abs(q - netMtInv) <= tolInv;
    const dayGap = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;
    const vehKey = normalizeVehicle(w.vehicle);
    const sameVeh = vehKey ? evidence.salesInvoicesByVehicle.get(vehKey) || [] : [];
    const subsetFit = (pool: SalesInvoiceRec[], base: number): SalesInvoiceRec[][] => {
      const hits: SalesInvoiceRec[][] = [];
      const n = Math.min(pool.length, 6);
      for (let m = 1; m < (1 << n); m++) { const pick = pool.slice(0, n).filter((_, i) => m & (1 << i)); if (pick.length <= 3 && fits(base + pick.reduce((t, r) => t + (r.qtyMt ?? 0), 0))) hits.push(pick); }
      return hits;
    };
    if (!invoice && netMtInv != null && netMtInv > 0) {
      const near = perInvoice(sameVeh.filter(r => dayGap(r.date, ctx.date) <= 1 && !ctx.excludeErp?.has(up(r.invoiceNo))));
      const single = near.filter(r => fits(r.qtyMt));
      if (single.length === 1) { invoice = single[0]; invoiceHow = 'vehicle + date + weight'; }
      else if (single.length === 0 && near.length > 1) { const combos = subsetFit(near, 0); if (combos.length === 1) { invoice = combine(combos[0]); invoiceHow = 'vehicle + date + weight (several invoices)'; } }
      if (!invoice && near.length === 1 && single.length === 0) { invoice = near[0]; invoiceHow = 'vehicle + date (quantity differs)'; }
      if (invoice) notes.push(`The gate record carries no matching invoice/SO; invoice ${invoice.invoiceNo} was linked by ${invoiceHow}.`);
    } else if (invoice && netMtInv != null && netMtInv > 0 && !fits(invoice.qtyMt)) {
      // One weighment, several invoices: the truck's other invoices of that day bring the quantity up to the weighbridge net.
      const sib = perInvoice(sameVeh.filter(r => r.date === invoice!.date && up(r.invoiceNo) !== up(invoice!.invoiceNo) && !ctx.excludeErp?.has(up(r.invoiceNo))));
      const combos = subsetFit(sib, invoice.qtyMt ?? 0);
      if (combos.length === 1) { invoice = combine([invoice, ...combos[0]]); invoiceHow = 'gate invoice + same-truck invoices'; notes.push(`One weighment carries ${invoice.parts!.length} invoices (${invoice.invoiceNo}); quantity and amount are compared on their total.`); }
    }
  }
  const erpRef = receipt?.rnNo ?? invoice?.invoiceNo ?? null;
  const erpInvoice = receipt?.billNo ?? invoice?.invoiceNo ?? null;
  const erpQty = receipt ? (receipt.weight ?? receipt.billQty) : invoice?.qtyMt ?? null;
  const erpRate = receipt?.billRate ?? invoice?.rate ?? null;
  const erpAmount = receipt?.billValue ?? invoice?.totalInvoiceAmount ?? invoice?.amount ?? null;
  const erpProv = receipt?.prov ?? invoice?.prov;
  if (erpProv && erpRef) {
    add('ERP', 'ERP Reference', erpRef, up(erpRef), erpProv, receipt ? (lotNo && evidence.receiptsByLot.has(up(lotNo)) ? 'ERP purchase receipt by Lot' : 'ERP purchase receipt by PO + invoice/vehicle') : `ERP sales invoice by ${invoiceHow || (supplierInvoice ? 'gate invoice number' : 'SO + vehicle/date')}`, receipt && lotNo ? 1 : /weight/.test(invoiceHow) ? 0.9 : 0.85);
    conf.push(receipt && lotNo ? 1 : 0.85); methods.push(`ERP: ${receipt ? (lotNo ? 'lot' : 'PO+invoice/vehicle') : 'sales invoice'}`);
    if (receipt && supplierInvoice && receipt.billNo && !invoiceMatches(receipt.billNo, supplierInvoice) && !invoiceMatches(supplierInvoice, receipt.billNo)) notes.push(`ERP bill number ${receipt.billNo} differs from the Gate Entry supplier invoice ${supplierInvoice}.`);
  }
  const nonStockPre = (type === 'Purchase' || type === 'Others') && !lotNo && !receipt && (product.matchMethod === 'not_found' || !product.masterProductType); // no lot means no Credit/Debit Note either
  if (isPurchase && !receipt && !nonStockPre && !statuses.includes('REVIEW REQUIRED')) statuses.push('ERP MISSING');
  if (isSales && !invoice && !statuses.includes('REVIEW REQUIRED')) statuses.push('ERP MISSING');

  // ---- QC / Settlement / CN-DN --------------------------------------------
  const qcRows = lotNo ? evidence.qcByLot.get(up(lotNo)) || [] : [];
  const stRows: SettlementRec[] = lotNo ? evidence.settlementsByLot.get(up(lotNo)) || [] : [];
  let cdn: CdnRec | null = null;
  if (lotNo) { const all = evidence.cdnByLot.get(up(lotNo)) || []; cdn = all.length > 1 ? all.find(c => supplierInvoice && invoiceMatches(c.invoiceNo, supplierInvoice)) || all[0] : all[0] || null; }
  // A sample's oil entered as 0 is "not tested" (rice bran is never 0% oil; broken rice lots have 0 on every sample): those samples are not counted.
  const qcAll = qcRows.map(r => r.oil).filter((v): v is number => v != null);
  const qcTested = qcAll.filter(v => v > 0);
  const qcZeroNote = qcAll.length && qcTested.length < qcAll.length ? (qcTested.length ? `${qcAll.length - qcTested.length} of ${qcAll.length} Inward QC sample(s) have oil entered as 0 (not tested) and are not counted.` : `Inward QC has oil entered as 0 on all ${qcAll.length} sample(s) — oil was not tested, so there is no QC oil to compare.`) : '';
  if (qcZeroNote) notes.push(qcZeroNote);
  const oil = computeQcOil(product.masterCategory, qcTested, cdn?.repOil ?? null);
  const settlementApplicable = isPurchase && isRaw;
  if (isPurchase && oilApplicable && lotNo && (!qcRows.length || !qcTested.length)) statuses.push('QC MISSING');
  if (oil.status === 'MISMATCH') statuses.push('OIL MISMATCH');
  if (settlementApplicable && lotNo) {
    if (stRows.length && !cdn) statuses.push('SETTLEMENT PENDING');
    if (!cdn) statuses.push('CN/DN PENDING');
  }
  if (qcRows[0]) { add('QC', 'QC Oil %', qcRows.map(r => r.oil).join(' / '), oil.qcOil ?? '', qcRows[0].prov, 'Inward QC samples for the lot, averaged (samples entered as 0 are not tests and are not counted)', 1); conf.push(1); methods.push('QC: lot'); }
  if (cdn) { add('Settlement', 'CN/DN Number', cdn.referenceNumber, up(cdn.referenceNumber), cdn.prov, 'Credit/Debit Note by Lot', 1); conf.push(1); methods.push('CN/DN: lot'); }
  if (stRows[0]) add('Settlement', 'Settlement Reference', stRows[0].referenceNo, up(stRows[0].referenceNo), stRows[0].prov, 'Settlement Pending report by Lot', 1);
  if (cdn && oilApplicable && cdn.labOil != null && oil.qcOil != null && Math.abs(cdn.labOil - oil.qcOil) > 0.05) notes.push(`CN/DN records Lab Oil ${cdn.labOil}% while the Inward QC average is ${oil.qcOil}%.`);
  // Credit/Debit Note's bill-side GST, also surfaced early in the ERP
  // section as a compact Bill Value/GST/IGST/Total Value cross-check
  // against ERP Amount.
  if (cdn && (cdn.sgst != null || cdn.cgst != null || cdn.igst != null)) { add('ERP', 'GST (CN/DN)', `${cdn.sgst ?? 0}+${cdn.cgst ?? 0} SGST/CGST, ${cdn.igst ?? 0} IGST`, cdn.totalGst ?? '', cdn.prov, 'Credit/Debit Note GST by Lot', 1); conf.push(1); methods.push('CN/DN GST: lot'); }

  // ---- Tally: booking voucher + payment references ------------------------
  let booking: { ledger: TallyLedgerVoucher | null; v: TallyVoucher | null; rule: string; confidence: number } | null = null;
  const exactRefs = [...(invoice?.parts?.map(p => p.invoiceNo) || []), erpRef, invoice?.invoiceNo].filter((x): x is string => !!x);
  for (const r of exactRefs) { const hit = ledger.byNewRef.get(up(r)); if (hit?.length === 1) { booking = { ledger: hit[0], v: null, rule: `ERP reference ${r} = Tally "New Ref"`, confidence: 1 }; break; } }
  // Exact purchase keys, before any name scoring: a purchase booking's voucher number IS the ERP receipt number, and its
  // "New Ref" is the lot composite (lot + supplier invoice). A key that points at exactly one purchase voucher settles it;
  // more than one is narrowed by the supplier invoice, and anything still ambiguous is left to the scored match below.
  const isPurchaseBooking = (v: TallyLedgerVoucher) => /purchase/i.test(v.vchType) && !/order/i.test(v.vchType);
  const lotsBookedBy = (v: TallyLedgerVoucher) => new Set(v.refs.filter(r => /new ref/i.test(r.kind)).map(r => splitCompositeRef(r.ref)?.lot).filter((x): x is string => !!x));
  // (Inter/Job Work transfers also carry an ERP purchase receipt whose number is the voucher number.)
  if (!booking && (isPurchase || !!receipt)) {
    const byNo = erpRef ? (ledger.byVchNo.get(up(erpRef).replace(/\s+/g, '')) || []).filter(isPurchaseBooking) : [];
    // A voucher that books a different lot than this transaction's own is somebody else's, however its number reads.
    const byNoOwn = byNo.filter(v => { const l = lotsBookedBy(v); return !lotNo || !l.size || l.has(up(lotNo)); });
    if (byNoOwn.length === 1) booking = { ledger: byNoOwn[0], v: null, rule: `ERP receipt ${erpRef} = Tally voucher number`, confidence: 1 };
    else if (lotNo) {
      const refs = (ledger.newRefByLot.get(up(lotNo)) || []).filter(p => isPurchaseBooking(p.voucher));
      const vouchers = [...new Map(refs.map(p => [p.voucher.key, p.voucher])).values()];
      const inv = supplierInvoice || receipt?.billNo || '';
      if (vouchers.length === 1) booking = { ledger: vouchers[0], v: null, rule: `Lot ${lotNo} = Tally "New Ref" of the purchase booking`, confidence: refs.some(p => inv && invoiceMatches(p.rest, inv)) ? 1 : 0.98 };
      else if (vouchers.length > 1) {
        const byInv = [...new Map(refs.filter(p => inv && invoiceMatches(p.rest, inv)).map(p => [p.voucher.key, p.voucher])).values()];
        if (byInv.length === 1) booking = { ledger: byInv[0], v: null, rule: `Lot ${lotNo} + supplier invoice ${inv} = Tally "New Ref" of the purchase booking`, confidence: 1 };
        else notes.push(`${vouchers.length} Tally purchase vouchers book Lot ${lotNo} (${vouchers.map(x => x.vchNo).join(', ')}) and the supplier invoice did not single one out.`);
      }
    }
  }
  // Non-stock transactions (water, store material, services...) have no PO, lot or ERP receipt by nature. Their evidence is the Tally
  // bill (a purchase voucher of the same party near the weighment date) and the payment against it — a weekly water payment names a
  // date range ("29.08.26 to 04.09.26") instead of a bill number.
  const nonStock = (type === 'Purchase' || type === 'Others') && !lotNo && !receipt && !cdn && (product.matchMethod === 'not_found' || !product.masterProductType);
  let nsRange: RangePayment | null = null;
  let nsByElimination = '';
  const sim = ctx.partySim || nameSimilarity;
  if (nonStock && !booking && w.party) {
    let bestV: TallyLedgerVoucher | null = null, bestGap = Infinity;
    for (const v of ctx.nonStockVouchers || []) {
      const gap = (Date.parse(v.date) - Date.parse(ctx.date)) / 86400000;
      if (gap < -3 || gap > 10 || Math.abs(gap) >= bestGap) continue;
      if (sim(w.party, v.party) >= 0.8) { bestV = v; bestGap = Math.abs(gap); }
    }
    if (bestV) booking = { ledger: bestV, v: null, rule: 'Non-stock bill: Tally purchase voucher of the same party within days of the weighment', confidence: 0.7 };
    else {
      const covers = (r: RangePayment) => ctx.date >= r.from && ctx.date <= r.to;
      nsRange = ledger.rangePayments.find(r => covers(r) && sim(w.party, r.voucher.party) >= 0.8) || null;
      // Water: a weighbridge name that is no Tally ledger (a driver or owner's name) belongs to the water supplier that no OTHER weighbridge name
      // accounts for — by elimination, and said so in the data-quality flag. (Weekly loads agreed: 31 trips = 31 loads in the week of 05.09.)
      if (!nsRange && /WATER/i.test(w.material) && !/SEPTIC/i.test(w.material) && ledger.waterSuppliers.size) {
        // only suppliers that were regularly booking water around this trip, and no other weighbridge name accounts for
        const near = (dates: string[]) => dates.filter(d => Math.abs(Date.parse(d) - Date.parse(ctx.date)) <= 45 * 86400000).length >= 3; // a regular water supplier, not a one-off posting
        const free = [...ledger.waterSuppliers].filter(([sName, dates]) => near(dates) && !(ctx.claimedSuppliers || new Set<string>()).has(sName)).map(([sName]) => sName);
        nsRange = ledger.rangePayments.find(r => covers(r) && free.includes(r.voucher.party.toUpperCase())) || null;
        if (nsRange) nsByElimination = nsRange.voucher.party;
      }
    }
    if (nsRange) { add('Tally', 'Tally Agst Ref', nsRange.ref.ref, `${nsRange.from} to ${nsRange.to}`, { origin: 'upload', file: nsRange.voucher.file, sheet: nsRange.voucher.sheet, row: String(nsRange.ref.row) }, 'Weekly payment whose reference is a date range that covers this trip', 0.7); conf.push(0.7); methods.push('Tally: weekly payment range'); }
  }
  // Job-work invoices (JW...) are not booked in Tally at all (no JWBARI voucher exists in the Day Book); a name-scored guess would only pick an unrelated voucher.
  const tallyNotExpected = !!invoice && /^JW/i.test(invoice.invoiceNo);
  if (!booking && type !== 'Others' && !nonStock && !tallyNotExpected) {
    const best = ctx.bookingScore(w, gate, ctx.category);
    const led = best ? ledger.byKey.get(`${best.v.sheet}|${best.v.sources[0]?.row}`) || null : null;
    // A voucher that already books a DIFFERENT ERP/invoice reference belongs to that transaction, however well the party/amount scores.
    const newRefs = (led?.refs || []).filter(r => /new ref/i.test(r.kind)).map(r => up(r.ref));
    const knownErp = new Set<string>([...evidence.receiptsByLot.values(), ...evidence.receiptsByPo.values()].flat().map(r => up(r.rnNo)));
    for (const k of evidence.salesInvoiceByNo.keys()) knownErp.add(k);
    const claimedElsewhere = !!erpRef && [...newRefs, up(best?.v.vchNo)].some(r => knownErp.has(r) && r !== up(erpRef));
    // The voucher's own New Ref names the lot it books; if that is a different lot it belongs to that lot's transaction.
    const bookedLots = led ? lotsBookedBy(led) : new Set<string>();
    const otherLot = (isPurchase || !!receipt) && !!lotNo && bookedLots.size > 0 && !bookedLots.has(up(lotNo));
    // A name-scored candidate (no exact key) whose amount is far from the ERP document's is a different transaction, not a mismatch.
    const refAmount = receipt?.billValue ?? invoice?.totalInvoiceAmount ?? null;
    const candAmount = led?.amount ?? null;
    const amountFar = refAmount != null && refAmount > 0 && candAmount != null && Math.abs(candAmount - refAmount) / refAmount > 0.2;
    if (best && amountFar && best.v.stage === 'BOOKING') notes.push(`The closest Tally voucher (${best.v.vchNo}, ${inr(candAmount as number)}) was not taken: its amount is more than 20% away from the ERP document (${inr(refAmount as number)}).`);
    if (best && best.v.stage === 'BOOKING' && !claimedElsewhere && !otherLot && !amountFar) booking = { ledger: ledger.byKey.get(`${best.v.sheet}|${best.v.sources[0]?.row}`) || null, v: best.v, rule: `Tally candidate scoring: ${best.evidence.slice(0, 3).join('; ')}`, confidence: Math.min(1, best.score / 100) };
  }
  if (booking && ctx.excludeTally?.size) {
    const no = up(booking.ledger?.vchNo ?? booking.v?.vchNo ?? '');
    if (no && ctx.excludeTally.has(no)) { notes.push(`Tally voucher ${no} belongs to another weighment (the one linked to its own ERP document) and was not taken for this load.`); booking = null; }
  }
  const tv = booking?.ledger ?? null;
  if (booking) {
    const ref = tv ? { origin: 'upload' as const, file: tv.file, sheet: tv.sheet, row: String(tv.row) } : booking.v ? { origin: 'upload' as const, file: booking.v.sources[0]?.file || 'Tally', sheet: booking.v.sheet, row: String(booking.v.sources[0]?.row ?? '') } : null;
    if (ref) add('Tally', 'Tally Voucher No.', tv?.vchNo ?? booking.v?.vchNo ?? '', up(tv?.vchNo ?? booking.v?.vchNo ?? ''), ref, booking.rule, booking.confidence);
    conf.push(booking.confidence); methods.push(`Tally: ${booking.confidence === 1 ? 'exact reference' : 'scored'}`);
  }
  // One weighment carrying several invoices has one Tally booking per invoice; they are totalled.
  const extraBookings = (invoice?.parts || []).slice(1).map(p => { const h = ledger.byNewRef.get(up(p.invoiceNo)); return h?.length === 1 && h[0].key !== tv?.key ? h[0] : null; }).filter((x): x is TallyLedgerVoucher => !!x);
  const allBook = tv ? [tv, ...extraBookings] : [];
  const tallyDate = tv?.date ?? booking?.v?.date ?? '', tallyType = tv?.vchType ?? booking?.v?.vchType ?? '', tallyNo = allBook.length > 1 ? allBook.map(x => x.vchNo).join(' + ') : tv?.vchNo ?? booking?.v?.vchNo ?? '', tallyParty = tv?.party ?? booking?.v?.party ?? '';
  const sumOf = (k: 'amount' | 'credit' | 'debit') => allBook.some(x => x[k] != null) ? Number(allBook.reduce((t, x) => t + (x[k] ?? 0), 0).toFixed(2)) : null;
  const tallyAmount = allBook.length > 1 ? sumOf('amount') : tv?.amount ?? null;
  const tallyCreditAmt = allBook.length > 1 ? sumOf('credit') : tv?.credit ?? null;
  if (isPurchase && !booking && !nsRange && !statuses.includes('REVIEW REQUIRED')) statuses.push('TALLY MISSING');
  if (nonStock && type === 'Others' && !booking && !nsRange) statuses.push('TALLY MISSING');
  if (isSales && !booking && !tallyNotExpected && !statuses.includes('REVIEW REQUIRED')) statuses.push('TALLY MISSING');
  if (tallyNotExpected) notes.push(`Job-work invoice ${invoice!.invoiceNo}: job-work invoices are not booked in Tally, so no Tally voucher is expected.`);

  // Payment: Agst Ref lines whose composite starts with the lot; the suffix
  // is only treated as the supplier invoice when it matches the Gate Entry's.
  // The BOOKING voucher's own Agst Ref line (the reconciliation note Tally
  // prints directly beneath the voucher it belongs to — confirmed live: it
  // sits one row after the booking voucher itself) is excluded here — it is
  // not a separate cash payment, it is the same voucher already counted as
  // tallyAmount/Amount Difference. Counting it again as a "payment" was
  // inflating Tally Payment Amount and creating a false Payment Difference
  // even when nothing was actually paid twice.
  // A genuine payment against a purchase lot is always the supplier's
  // account being DEBITED (paying down what's owed) — Dr, never Cr — but
  // Dr alone is NOT enough: confirmed against real data, a Journal or Debit
  // Note voucher posting the CN/DN's own charges/rebate adjustment ALSO
  // debits the supplier and ALSO carries an "Agst Ref" line for the same
  // lot composite, with nothing cash actually changing hands — those
  // amounts are already inside Settlement Net Value (Weighing/Unloading/
  // TDS/Rebate), so counting them again here as a "payment" double-counts
  // the same adjustment and produces a Payment Difference that isn't real.
  // Only a voucher whose own type is actually a Payment voucher represents
  // money paid to the supplier; a lot with no such voucher yet is simply
  // unpaid so far, not a mismatch.
  let allLotRefs = (lotNo ? ledger.paymentsByLot.get(up(lotNo)) || [] : []).filter(p => !tv || p.voucher.key !== tv.key);
  // Bookings before about 7 Sep carry a serial-only reference (see LedgerIndex.bySerial): the serial plus the SAME PARTY as the booking.
  const lotSerial = lotNo ? (lotNo.split('/')[1] || '') : '';
  if (!allLotRefs.length && lotSerial && /^\d{6,8}$/.test(lotSerial)) {
    const party = tv?.party || receipt?.supplier || cdn?.customerName || w.party;
    const sameParty = (v: TallyLedgerVoucher) => !!party && (tv ? up(v.party) === up(tv.party) : (ctx.partySim || nameSimilarity)(party, v.party) >= 0.8);
    allLotRefs = (ledger.bySerial.get(lotSerial) || []).filter(p => (!tv || p.voucher.key !== tv.key) && !/new ref/i.test(p.ref.kind) && sameParty(p.voucher));
    if (allLotRefs.length) methods.push('Tally: serial-only reference + party');
  }
  const drLotRefs = allLotRefs.filter(p => /^dr/i.test(p.ref.drcr));
  let payRefs = drLotRefs.filter(p => /payment/i.test(p.voucher.vchType));
  let payRule = 'Payment voucher, Agst Ref (Dr) contains the lot';
  if (supplierInvoice && payRefs.length) { const strict = payRefs.filter(p => invoiceMatches(p.rest, supplierInvoice)); if (strict.length) { payRefs = strict; payRule = 'Payment "Agst Ref" = lot + supplier invoice (invoice confirmed against Gate Entry)'; } else notes.push(`Tally payment reference(s) for lot ${lotNo} do not carry supplier invoice ${supplierInvoice} — shown as lot-only evidence.`); }
  const payAmount = payRefs.length ? payRefs.reduce((s, p) => s + (p.ref.amount ?? 0), 0) : null;
  for (const p of payRefs.slice(0, 3)) add('Tally', 'Tally Agst Ref', p.ref.ref, `${p.lot} + ${p.rest || '(no invoice suffix)'}`, { origin: 'upload', file: p.voucher.file, sheet: p.voucher.sheet, row: String(p.ref.row) }, payRule, p.rest && supplierInvoice && invoiceMatches(p.rest, supplierInvoice) ? 1 : 0.7);
  if (payRefs.length) { conf.push(payRefs.some(p => supplierInvoice && invoiceMatches(p.rest, supplierInvoice)) ? 1 : 0.7); methods.push('Payment: Agst Ref'); }
  // Every OTHER Dr-marked Agst Ref for this lot — Journal/Debit Note/Credit
  // Note vouchers posting the CN/DN's own charges and rebate as an
  // adjustment against what's owed, never a cash Payment voucher (those are
  // payRefs above). This is what Settlement Net Value is actually computed
  // from below — see the note there for why.
  const adjustmentRefs = drLotRefs.filter(p => !/payment/i.test(p.voucher.vchType));
  const tallyAdjustment = adjustmentRefs.length ? adjustmentRefs.reduce((s, p) => s + (p.ref.amount ?? 0), 0) : 0;
  for (const p of adjustmentRefs.slice(0, 3)) add('Tally', 'Tally Agst Ref', p.ref.ref, `${p.voucher.vchType} ${p.voucher.vchNo}: ₹${p.ref.amount}`, { origin: 'upload', file: p.voucher.file, sheet: p.voucher.sheet, row: String(p.ref.row) }, `${p.voucher.vchType} adjustment against booking, Agst Ref (Dr) contains the lot`, 0.9);
  // Credit side: a Credit Note voucher posts the note's rebate as a CREDIT "Agst Ref" on the lot — it adds to what is owed. It was
  // never counted before, which is why every credit-note lot showed a settlement value short by the credit note.
  const crAdjRefs = allLotRefs.filter(p => /^cr/i.test(p.ref.drcr) && /agst ref/i.test(p.ref.kind));
  const tallyCreditAdj = crAdjRefs.reduce((s2, p) => s2 + (p.ref.amount ?? 0), 0);
  for (const p of crAdjRefs.slice(0, 3)) add('Tally', 'Tally Agst Ref', p.ref.ref, `${p.voucher.vchType} ${p.voucher.vchNo}: ₹${p.ref.amount} (credit)`, { origin: 'upload', file: p.voucher.file, sheet: p.voucher.sheet, row: String(p.ref.row) }, `${p.voucher.vchType} credit against the lot, Agst Ref (Cr)`, 0.9);
  // Non-stock bills: payments by the bill's own reference (New Ref / voucher number), or the weekly range payment found above.
  const nsPay: { voucher: TallyLedgerVoucher; ref: TallyRef }[] = [];
  if (nonStock) {
    const norm = (x: string) => text(x).toUpperCase().replace(/\s+/g, '');
    if (tv) {
      const keys = new Set([...tv.refs.filter(r => /new ref/i.test(r.kind)).map(r => norm(r.ref)), norm(tv.vchNo)].filter(Boolean));
      const seenPay = new Set<string>();
      for (const k of keys) for (const pr of ledger.paymentsByRef.get(k) || []) { const id = `${pr.voucher.key}|${pr.ref.row}`; if (!seenPay.has(id)) { seenPay.add(id); nsPay.push(pr); } }
    } else if (nsRange) nsPay.push({ voucher: nsRange.voucher, ref: nsRange.ref });
    for (const pr of nsPay.slice(0, 3)) add('Tally', 'Tally Payment', pr.ref.ref, `Payment ${pr.voucher.vchNo}: ₹${pr.ref.amount ?? ''}`, { origin: 'upload', file: pr.voucher.file, sheet: pr.voucher.sheet, row: String(pr.ref.row) }, nsRange && !tv ? 'Weekly payment covering the trip date' : 'Payment voucher against the bill reference', 0.8);
  }
  const payList: { voucher: TallyLedgerVoucher; ref: TallyRef }[] = nonStock ? nsPay : payRefs;
  const payTotal = nonStock ? (nsPay.length ? Number(nsPay.reduce((t, p) => t + (p.ref.amount ?? 0), 0).toFixed(2)) : null) : payAmount;

  // ---- Variances -----------------------------------------------------------
  const grouped = ctx.group && ctx.group.size > 1 ? ctx.group : null;
  const netKg = grouped ? grouped.netKg : w.weight;
  const netMt = MT(netKg);
  // Unit-safe: packing material / unmatched products are counted in pieces or free text in ERP, so weight is not comparable.
  const qtyComparable = product.matchMethod !== 'not_found' && product.masterProductType !== 'packing_material';
  if (grouped) notes.push(`This ERP record is shared by ${grouped.size} weighments (split loads); quantity and amount are compared on the combined total.`);

  // ---- Bags: jute / plastic -------------------------------------------------
  // The ERP receipt weight is the weighbridge net LESS the bags, so a quantity "mismatch" that is only the bag weight is
  // not one. Bag counts come from the Purchase Register (what the ERP deducted), else the Credit/Debit Note, else the
  // Time Office gate record — the same figure in every source seen, so the first available is used.
  const tofRec = gate ? evidence.timeOfficeByGp.get(up(gate.gp)) || null : null;
  const juteBags = receipt?.juteBag ?? cdn?.juteBag ?? tofRec?.gunnyBags ?? null;
  const plasticBags = receipt?.plasticBag ?? tofRec?.plasticBags ?? null;
  const bagsKnown = isPurchase && (juteBags != null || plasticBags != null);
  const totalBags = !bagsKnown ? null : receipt?.totalBags ?? tofRec?.totalBags ?? (juteBags ?? 0) + (plasticBags ?? 0);
  const juteKg = (juteBags ?? 0) * JUTE_KG_PER_BAG, plasticKg = (plasticBags ?? 0) * PLASTIC_KG_PER_BAG;
  if (bagsKnown) add('ERP', 'Bags', `jute ${juteBags ?? 0}, plastic ${plasticBags ?? 0}`, `${juteKg + plasticKg} kg`, (receipt?.juteBag != null ? receipt.prov : cdn?.juteBag != null ? cdn.prov : tofRec?.prov) || wProv, `Bag counts from ${receipt?.juteBag != null || receipt?.plasticBag != null ? 'the Purchase Register' : cdn?.juteBag != null ? 'the Credit/Debit Note' : 'the Time Office gate record'}`, 1);
  // Which weight the ERP quantity is on: raw net, net less jute, or net less jute and plastic — whichever lands on the ERP figure.
  const bases: { label: string; kg: number }[] = [{ label: 'Net', kg: 0 }];
  if (bagsKnown && juteKg > 0) bases.push({ label: 'Net − jute', kg: juteKg });
  if (bagsKnown && plasticKg > 0) bases.push({ label: juteKg > 0 ? 'Net − jute − plastic' : 'Net − plastic', kg: juteKg + plasticKg });
  const diffOn = (kg: number) => (qtyComparable && netKg != null && erpQty != null ? Number(((netKg - kg) / 1000 - erpQty).toFixed(4)) : null);
  const chosenBasis = erpQty != null && netKg != null ? bases.reduce((best, b) => (Math.abs(diffOn(b.kg) ?? Infinity) < Math.abs(diffOn(best.kg) ?? Infinity) ? b : best), bases[0]) : bases.find(b => b.label === 'Net − jute') || bases[0];
  const qtyDiff = diffOn(chosenBasis.kg);
  const qtyTol = Math.max(QTY_TOLERANCE_MT, QTY_TOLERANCE_PCT * (netMt ?? 0));
  const rawDiff = diffOn(0);
  if (qtyDiff != null && Math.abs(qtyDiff) > qtyTol) statuses.push('QUANTITY MISMATCH');
  else if (rawDiff != null && Math.abs(rawDiff) > qtyTol && chosenBasis.kg > 0) notes.push(`Weighbridge net ${netMt} MT differs from ERP ${erpQty} MT by ${rawDiff} MT, which is the bag weight (${[juteKg ? `${juteBags} jute bag(s) × ${JUTE_KG_PER_BAG} kg` : '', plasticKg && chosenBasis.kg > juteKg ? `${plasticBags} plastic bag(s) × ${PLASTIC_KG_PER_BAG} kg` : ''].filter(Boolean).join(' + ')}); not a quantity mismatch.`);
  const netAfterBagsMt = netKg == null ? null : Number(((netKg - chosenBasis.kg) / 1000).toFixed(4));
  const cmpTally = grouped?.tallyAmount ?? tallyAmount;
  // The CN/DN's "BillValue" is the actual invoiced figure (confirmed:
  // matches ERP Amount, unlike the note's "Value" column). GST on it is a
  // flat 2.5% SGST + 2.5% CGST (5% combined) for an intra-state bill — the
  // note's own IGST field only ever carries a real figure for an
  // inter-state one, so that's the single signal used to pick which split
  // applies; never both at once.
  // The GST RATE is the note's own (its GST columns over its assessable Value): 5% for almost every lot, 0% for broken rice (BR lots,
  // which Tally books without GST too — confirmed on all 16 BR lots). A flat 5% on every lot is what produced the "GST tax added" error.
  const interState = !!(cdn?.igst && cdn.igst > 0);
  const hasBill = cdn?.billValue != null;
  const noteGst = cdn ? (cdn.totalGst ?? ((cdn.sgst ?? 0) + (cdn.cgst ?? 0) + (cdn.igst ?? 0))) : null;
  const gstRate = cdn && cdn.value != null && cdn.value > 0 && (cdn.totalGst != null || cdn.sgst != null || cdn.cgst != null || cdn.igst != null) ? Math.round(((noteGst ?? 0) / cdn.value) * 1000) / 1000 : 0.05;
  const billSgstScaled = !hasBill ? null : interState ? 0 : Number((cdn!.billValue! * gstRate / 2).toFixed(2));
  const billCgstScaled = !hasBill ? null : interState ? 0 : Number((cdn!.billValue! * gstRate / 2).toFixed(2));
  const billIgstScaled = !hasBill ? null : interState ? Number((cdn!.billValue! * gstRate).toFixed(2)) : 0;
  // Settlement Net Value is COMPUTED here from the CN/DN's own bill-side
  // figure, never trusted straight off the source file's own "NetValue"
  // column — that column has been observed to carry a value wildly
  // inconsistent with everything else on the same note (a source data
  // error), silently producing a huge, unexplained-looking gap against
  // Bill Value with nothing to audit. The real formula only ever touches
  // three deductions — Weightment, Unloading, TDS — never Lorry
  // Freight/Advance/Brokerage/Other Expenses, and the Rebate is a CREDIT
  // (added) for a Credit Note reference (CN-...) and a DEBIT (subtracted)
  // for a Debit Note reference (DN-...); a reference matching neither
  // prefix defaults to the credit/add behavior (the observed common case).
  // Both stay purely informational display columns below — NOT what
  // Settlement Net Value is computed from (see next).
  const billTotal = cdn && cdn.billValue != null ? cdn.billValue + (billSgstScaled ?? 0) + (billCgstScaled ?? 0) + (billIgstScaled ?? 0) : null;
  // Amount Difference compares against the Credit/Debit Note's own Total
  // Supplier Bill Value when one applies (Purchase, raw material) — the
  // ERP Amount (Purchase Register's own BillValue) column was removed as a
  // redundant, sometimes-inconsistent second copy of the same figure.
  // Sales and non-settlement transactions (no CN/DN at all) still use the
  // Sales Register / Purchase Register figure, since nothing else exists
  // for them.
  const erpCompareAmount = settlementApplicable && billTotal != null ? billTotal : erpAmount;
  const amtDiff = erpCompareAmount != null && cmpTally != null ? Number((erpCompareAmount - cmpTally).toFixed(2)) : null;
  const cnDnSign = cdn && /^dn/i.test(cdn.referenceNumber) ? -1 : 1;
  const rebateSigned = cdn && cdn.rebateNetValue != null ? cnDnSign * cdn.rebateNetValue : null;
  // Settlement Net Value is the Credit/Debit Note's own figure — it is FINAL: bill value + GST ± the note's rebate (a Credit Note
  // adds, a Debit Note subtracts) − weighing − unloading − TDS. Tally must agree with it; where it does not, the difference is shown
  // with its reason (Tally Settlement Value / Tally − Note Difference / Settlement Check). 154 of 193 real payments equalled this
  // value to the rupee; the note's own "NetValue" column is not used (it is unreliable and, for advance suppliers, nets the advance).
  const chargesTotal = (cdn?.weightment ?? 0) + (cdn?.unloading ?? 0) + (cdn?.tds ?? 0);
  const noteSettlement = settlementApplicable && billTotal != null ? Number((billTotal + (rebateSigned ?? 0) - chargesTotal).toFixed(2)) : null;
  // What Tally itself says is owed: the booking, less the debit postings (charges, debit note), plus the credit postings (credit note).
  const tallyNet = tallyAmount != null ? Number((tallyAmount - tallyAdjustment + tallyCreditAdj).toFixed(2)) : null;
  const settlementNet = noteSettlement;
  const payDiff = noteSettlement != null && payAmount != null ? Number((noteSettlement - payAmount).toFixed(2)) : null;
  const tallyDiff = tallyNet != null && noteSettlement != null ? Number((tallyNet - noteSettlement).toFixed(2)) : null;
  // An advance supplier is paid the whole bill up front (with or without the charges) and the note's adjustment is settled later:
  // that is a balance to settle, not a mismatch.
  const noteAdvance = !!(cdn?.advance && billTotal != null && cdn.advance >= 0.9 * billTotal);
  const advanceCase = payAmount != null && noteSettlement != null && billTotal != null && Math.abs(payAmount - noteSettlement) > AMOUNT_TOLERANCE
    && (noteAdvance || Math.abs(payAmount - (billTotal - (cdn?.tds ?? 0))) <= 1.5 || Math.abs(payAmount - (billTotal - chargesTotal)) <= 1.5 || Math.abs(payAmount - billTotal) <= 1.5);
  const balanceToSettle = payAmount != null && noteSettlement != null ? Number((noteSettlement - payAmount).toFixed(2)) : null;
  const payMismatch = payDiff != null && !advanceCase && Math.abs(payDiff) > AMOUNT_TOLERANCE;
  const tallyMismatch = payAmount == null && tallyDiff != null && Math.abs(tallyDiff) > AMOUNT_TOLERANCE;
  if ((amtDiff != null && Math.abs(amtDiff) > AMOUNT_TOLERANCE) || payMismatch || tallyMismatch) statuses.push('AMOUNT MISMATCH');
  // Why Tally and the note differ — stated, never guessed.
  const expectedDr = chargesTotal + (cnDnSign === -1 && cdn?.rebateNetValue != null ? cdn.rebateNetValue : 0);
  const expectedCr = cnDnSign === 1 && cdn?.rebateNetValue != null ? cdn.rebateNetValue : 0;
  const reasons: string[] = [];
  if (noteSettlement != null && tallyAmount != null) {
    if (amtDiff != null && Math.abs(amtDiff) > AMOUNT_TOLERANCE) reasons.push(cdn?.billValue != null && Math.abs(tallyAmount - cdn.billValue) <= 1.5 ? `Tally booking ${inr(tallyAmount)} is the bill WITHOUT GST (the note's bill with GST is ${inr(billTotal as number)})` : `Tally booking ${inr(tallyAmount)} differs from the note's bill total ${inr(billTotal as number)}`);
    const dnExpected = expectedDr - chargesTotal;
    if (Math.abs(tallyAdjustment - expectedDr) > AMOUNT_TOLERANCE) reasons.push(tallyAdjustment === 0 ? `the debit postings (charges ${inr(chargesTotal)}${dnExpected > 0 ? ` and debit note ${inr(dnExpected)}` : ''}) are not in Tally` : dnExpected > 0 && Math.abs(tallyAdjustment - chargesTotal) <= AMOUNT_TOLERANCE ? `the debit note ${cdn?.referenceNumber} (${inr(dnExpected)}) is not posted in Tally` : `Tally debit postings ${inr(tallyAdjustment)} vs ${inr(expectedDr)} on the note (charges ${inr(chargesTotal)}${dnExpected > 0 ? ` + debit note ${inr(dnExpected)}` : ''})`);
    if (Math.abs(tallyCreditAdj - expectedCr) > AMOUNT_TOLERANCE) reasons.push(tallyCreditAdj === 0 ? `the credit note ${cdn?.referenceNumber} (${inr(expectedCr)}) is not posted in Tally` : `Tally credit note ${inr(tallyCreditAdj)} vs ${inr(expectedCr)} on ${cdn?.referenceNumber}`);
  }
  if (advanceCase && payAmount != null && balanceToSettle != null) reasons.push(`paid in advance ${inr(payAmount)} (the full bill); balance ${inr(balanceToSettle)} ${balanceToSettle > 0 ? 'still to be paid to the supplier' : 'to be recovered from the supplier'}`);
  else if (payMismatch && payAmount != null && payDiff != null) reasons.push(payAmount < (noteSettlement as number) ? `paid ${inr(payAmount)}, ${inr(payDiff)} short of the note value` : `paid ${inr(payAmount)}, ${inr(-payDiff)} more than the note value`);
  const settlementCheck = noteSettlement == null ? NA : !reasons.length ? (tallyAmount == null ? 'Tally booking not found' : 'Tally agrees with the Credit/Debit Note') : reasons.join('; ');
  if (noteSettlement != null && reasons.length) notes.push(`Settlement (Credit/Debit Note value ${inr(noteSettlement)}): ${reasons.join('; ')}.`);
  // Payment status: PAID / PART PAID / OVER PAID against the final value, ADVANCE PAID with its balance, or NOT PAID.
  const payCompare = noteSettlement ?? tallyAmount;
  let paymentStatus: string = NA;
  if ((isPurchase || nonStock) && (booking || nsRange)) {
    if (payTotal == null) paymentStatus = noteAdvance ? 'ADVANCE PAID (per note)' : 'NOT PAID';
    else if (advanceCase) paymentStatus = 'ADVANCE PAID';
    else if (nsRange && !tv) paymentStatus = 'PAID (weekly payment)';
    else if (payCompare == null) paymentStatus = 'PAID';
    else paymentStatus = Math.abs(payTotal - payCompare) <= AMOUNT_TOLERANCE ? 'PAID' : payTotal < payCompare ? 'PART PAID' : 'OVER PAID';
  }

  // ---- Settlement checks (information only: no status is raised from these) ----
  // The note settles on the weighbridge net less jute. Where its Final Weight differs the cause is usually a keyed-in
  // weight or a payment on gross weight; the rupee effect is the weight gap at the note's own effective rate (Value / Final Weight).
  // Only the Credit/Debit Note's Final Weight is on the jute-only basis; the Settlement Pending list's quantity is the ERP weight (bags already taken off), so it is not compared here.
  const settlementWt = settlementApplicable ? cdn?.finalWeight ?? null : null;
  const settlementBasisMt = netKg == null ? null : Number(((netKg - juteKg) / 1000).toFixed(4));
  const settlementWtDiff = settlementWt != null && settlementBasisMt != null ? Number((settlementWt - settlementBasisMt).toFixed(4)) : null;
  const effectiveRate = cdn?.value != null && cdn.finalWeight ? cdn.value / cdn.finalWeight : null;
  const settlementWtDiffValue = settlementWtDiff != null && effectiveRate != null ? Number((settlementWtDiff * effectiveRate).toFixed(2)) : null;
  if (settlementWtDiff != null && Math.abs(settlementWtDiff) > SETTLEMENT_WEIGHT_TOLERANCE_MT) {
    const onGross = netMt != null && juteKg > 0 && Math.abs((settlementWt as number) - netMt) <= SETTLEMENT_WEIGHT_TOLERANCE_MT;
    notes.push(onGross
      ? `Settlement weight ${settlementWt} MT equals the weighbridge net WITHOUT the jute deduction (${settlementBasisMt} MT after ${juteBags} jute bag(s)) — settled on gross weight, ${Math.abs(settlementWtDiff)} MT${settlementWtDiffValue != null ? ` (about ${inr(settlementWtDiffValue)})` : ''} more than due.`
      : `Settlement weight ${settlementWt} MT differs from the weighbridge net after jute (${settlementBasisMt} MT) by ${settlementWtDiff} MT${settlementWtDiffValue != null ? ` (about ${inr(settlementWtDiffValue)})` : ''} — the weight on the note may have been keyed in or revised.`);
  }
  // ---- Gunny cost ---------------------------------------------------------------
  const gunnyRate = cdn?.packRate ?? null, gunnyCost = cdn?.packCost ?? null;
  if (settlementApplicable && cdn && (cdn.juteBag ?? 0) > 0 && !(gunnyRate && gunnyRate > 0)) {
    const seen = ctx.gunnyRates?.get(up(cdn.customerName).replace(/[^A-Z0-9]/g, ''));
    if (seen) notes.push(`No gunny cost on the Credit/Debit Note for ${cdn.juteBag} jute bag(s), while ${cdn.customerName || 'this supplier'} was charged ₹${seen.rate}/bag on ${seen.lots} other lot(s) in this run (would be ${inr((cdn.juteBag as number) * seen.rate)}).`);
  }

  // ---- Data-quality flags: typos and mismatching identities the team should fix at the source ----
  const flags: string[] = [];
  if (lot.source === 'weight_reassigned') flags.push(`Lot taken from the ERP receipt that matches this load's weight (typed/gate lot did not agree)`);
  const nv = normalizeVehicle(w.vehicle);
  if (nv && !VEHICLE_FORMAT.test(nv)) flags.push(`Vehicle number "${w.vehicle}" does not look like a registration number`);
  if (receipt?.vehicle && nv && normalizeVehicle(receipt.vehicle) !== nv) flags.push(`Vehicle differs: weighment ${w.vehicle} vs ERP ${receipt.vehicle}`);
  if (lot.source === 'file_unresolved' || lot.source === 'ambiguous') flags.push(`Lot "${w.lot}" typed on the weighment was not found in the ERP/Time Office — check for a typing mistake`);
  else if (w.lot && lotNo && !up(lotNo).split('/').includes(w.lot.replace(/\s+/g, '').toUpperCase()) && up(lotNo) !== w.lot.replace(/\s+/g, '').toUpperCase()) flags.push(`Weighment lot "${w.lot}" differs from the lot ${lotNo} that the gate pass resolves to`);
  const partyRef = receipt?.supplier || cdn?.customerName || '';
  if (w.party && partyRef && nameSimilarity(w.party, partyRef) < PARTY_NAME_FLAG_BELOW) flags.push(`Party name differs: weighment "${w.party}" vs ERP "${partyRef}"`);
  if (tallyParty && w.party && nameSimilarity(w.party, tallyParty) < PARTY_NAME_FLAG_BELOW && (!partyRef || nameSimilarity(partyRef, tallyParty) < PARTY_NAME_FLAG_BELOW)) flags.push(`Tally party "${tallyParty}" differs from "${w.party}"`);
  if (!(w.weight && w.weight > 0) && (w.grossWeight ?? 0) > 0) flags.push('Incomplete weighment: gross weight only — the second (tare) weighing is missing, so there is no net weight');
  if (nsByElimination) flags.push(`Weighment party "${w.party}" is not a Tally ledger; matched to the weekly water payment of "${nsByElimination}" by elimination — please confirm`);
  const erpProductRaw = receipt?.product || invoice?.product || '';
  if (erpProductRaw && product.matchMethod !== 'not_found' && w.material && nameSimilarity(w.material, erpProductRaw) < 0.55 && product.raw === w.material && ['lot_record', 'erp_record'].includes(product.matchMethod)) flags.push(`Weighbridge material "${w.material}" differs from the ERP product "${erpProductRaw}" (the ERP product is used)`);
  if ((isPurchase || nonStock) && booking && !payList.length && ledger.coverage) notes.push(`No payment voucher for this lot/bill was found in the uploaded Tally Day Book (it covers ${ledger.coverage.from} to ${ledger.coverage.to}); a payment made outside that range will not show.`);
  else if ((isPurchase || nonStock) && !booking && !nsRange && ledger.coverage && ctx.date > ledger.coverage.to) notes.push(`This transaction (${ctx.date}) is after the last date in the uploaded Tally Day Book (${ledger.coverage.to}) — upload a Day Book that covers it.`);

  // ---- Sales (debtors) sheet fields: GST split, receipts, quality cut. Display only. ----
  let salesFields: Record<string, string | number> = Object.fromEntries(SALES_FIELD_KEYS.map(k => [k, NA]));
  if (isSales) {
    const sd = salesDebtorFields(invoice, ledger, product.masterProductName || w.material || '', w.party);
    salesFields = sd.fields; notes.push(...sd.notes);
    for (const c of sd.receipts.slice(0, 6)) add('Tally', 'Receipt', c.ref.ref, `${c.voucher.vchType} ${c.voucher.vchNo}: ₹${c.ref.amount ?? ''}`, { origin: 'upload', file: c.voucher.file, sheet: c.voucher.sheet, row: String(c.ref.row) }, 'Receipt voucher "Agst Ref" (Cr) = ERP invoice number', 1);
  }

  // ---- Roll-up ------------------------------------------------------------
  if (product.matchMethod === 'not_found' && !nonStock && !statuses.includes('REVIEW REQUIRED')) statuses.push('REVIEW REQUIRED');
  // Same statuses the row had as 'Others' (no extra Review Required for the missing gate): only its category changes.
  const naturePurchaseNoGate = ctx.categoryReason === PURCHASE_BY_NATURE_REASON && nonStock;
  if ((type === 'Purchase' || type === 'Sales') && !gate && !naturePurchaseNoGate && !statuses.includes('REVIEW REQUIRED')) { statuses.push('REVIEW REQUIRED'); notes.push('No Gate record could be linked, so PO/SO/invoice could not be established from operational evidence.'); }
  const gateFound = !!gate;
  const hasTally = !!booking || !!nsRange;
  if (type === 'Others') { if (!(nonStock && hasTally) && !gateFound && !statuses.includes('REVIEW REQUIRED')) statuses.push('NOT MATCHED'); }
  else if (type === 'Inter/Job Work') { const found = [gateFound, !!(receipt || invoice), !!booking || tallyNotExpected].filter(Boolean).length; if (!found) statuses.push('NOT MATCHED'); else if (found < 3) statuses.push('PARTIAL MATCH'); }
  else if (!gateFound && !erpRef && !hasTally && !statuses.includes('NOT MATCHED')) statuses.push('NOT MATCHED');
  else if (statuses.length && (gateFound || erpRef || hasTally)) statuses.push('PARTIAL MATCH');
  const uniq = [...new Set(statuses)] as ReconStatus[];
  const primaryStatus = pickPrimary(uniq.length ? uniq : ['FULLY MATCHED']);
  const finalStatuses: ReconStatus[] = uniq.length ? uniq : ['FULLY MATCHED'];

  // ---- Comment (deterministic, facts only — nothing here can invent a value)
  const matched = [gateFound && 'Gate Entry', erpRef && 'ERP', qcRows.length && 'QC', (stRows.length || cdn) && 'Settlement', hasTally && 'Tally'].filter(Boolean) as string[];
  const parts: string[] = [];
  const family = product.masterCategory || product.masterProductName || product.raw;
  if (primaryStatus === 'FULLY MATCHED') parts.push(`${type} of ${family} matched across ${matched.join(', ')}${lotNo ? ` using Lot ${lotNo}` : ''}${supplierInvoice ? ` and Supplier Invoice ${supplierInvoice}` : ''}.`);
  else parts.push(`${type} of ${family}${matched.length ? ` matched across ${matched.join(', ')}` : ' could not be matched to any downstream record'}${lotNo ? ` using Lot ${lotNo}` : ''}${supplierInvoice ? ` and Supplier Invoice ${supplierInvoice}` : ''}.`);
  if (!oilApplicable && isPurchase && product.matchMethod !== 'not_found') parts.push(`Oil reconciliation is N/A for ${product.masterCategory || product.masterProductName}.`);
  if (finalStatuses.includes('REVIEW REQUIRED') && product.matchMethod === 'not_found') parts.push(`Material "${product.raw}" could not be matched to the Product Master${product.aiSuggestion ? ` (AI suggests "${product.aiSuggestion.productName}", not applied)` : ''}.`);
  if (finalStatuses.includes('ERP MISSING')) parts.push('No ERP record was found for this transaction.');
  if (finalStatuses.includes('QC MISSING')) parts.push(qcRows.length ? `Inward QC for Lot ${lotNo} has no tested oil value (required for Rice Bran).` : `Inward QC was not found for Lot ${lotNo} (required for Rice Bran).`);
  if (finalStatuses.includes('OIL MISMATCH')) parts.push(`JMD/Report Oil ${oil.jmdOil}% vs QC Oil ${oil.qcOil}% (difference ${oil.oilDifference} points).`);
  if (finalStatuses.includes('SETTLEMENT PENDING')) parts.push('Lot is on the Settlement Pending list with no CN/DN issued yet.');
  else if (finalStatuses.includes('CN/DN PENDING')) parts.push('No Credit/Debit Note was found for this lot yet.');
  if (finalStatuses.includes('TALLY MISSING')) parts.push('No Tally booking voucher was identified.');
  if (finalStatuses.includes('QUANTITY MISMATCH') && qtyDiff != null) parts.push(`Weighbridge net ${netMt} MT vs ERP ${erpQty} MT (difference ${qtyDiff} MT).`);
  if (amtDiff != null && Math.abs(amtDiff) > AMOUNT_TOLERANCE) parts.push(`ERP Amount differs from the Tally booking by ${inr(amtDiff)}.`);
  parts.push(...notes);

  // Direct vs Indirect Purchase comes only from the Credit/Debit Note's PurchaseType column.
  const cdnPurchaseType = up(cdn?.purchaseType);
  const displayType: MasterRow['transactionType'] = type !== 'Purchase' ? type : /^DIRECT\b/.test(cdnPurchaseType) ? 'Direct Purchase' : /^(INDIRECT|NORMAL)\b/.test(cdnPurchaseType) ? 'Indirect Purchase' : 'Purchase';
  if (displayType !== type && cdn) add('Settlement', 'Purchase Type', cdn.purchaseType, displayType, cdn.prov, 'Credit/Debit Note PurchaseType column', 1);

  const confidence = conf.length ? Math.round((conf.reduce((s, x) => s + x, 0) / conf.length) * 100) : 0;
  const exceptionOnly = finalStatuses.filter(s => s !== 'FULLY MATCHED' && s !== 'PARTIAL MATCH');

  // Sales-sheet labels (display only): what kind of sale, who the load was delivered to, and whether the weighbridge had two weights.
  const salesLike = isSales || (type === 'Inter/Job Work' && !!invoice);
  const saleType = !salesLike ? NA : (/^JW/i.test(invoice?.invoiceNo || '') || ctx.categoryReason.startsWith('Job-work')) ? 'Job work' : (type === 'Inter/Job Work' || isGroupParty(invoice?.party || '') || isGroupParty(w.party)) ? 'Group company' : 'Direct sale';
  const weighmentStatus = (w.weight ?? 0) > 0 ? 'Weighed (gross and tare)' : (w.grossWeight ?? 0) > 0 ? 'Single weight (gross only)' : 'No weight recorded';

  const v: Record<string, string | number> = {
    reconId, transactionType: displayType, date: ctx.date, reconStatus: primaryStatus, exceptions: exceptionOnly.length ? exceptionOnly.join(', ') : NA, runId,
    gatePass: val(gate?.gp), vehicle: w.vehicle || NOT_FOUND, party: w.party || NOT_FOUND, material: w.material || NOT_FOUND,
    productMaster: val(product.masterProductName), productCategory: val(product.masterCategory), productMethod: product.matchMethod, productConfidence: Math.round(product.matchConfidence * 100),
    supplierInvoice: isPurchase || type === 'Inter/Job Work' ? val(supplierInvoice) : val(supplierInvoice, NA), po: po ? po : isPurchase ? NOT_FOUND : NA, so: so ? so : isSales ? NOT_FOUND : NA, lot: lotNo ?? (isPurchase && isRaw ? NOT_FOUND : NA),
    grossWeight: val(w.grossWeight), tareWeight: val(w.tareWeight), netWeight: val(w.weight),
    erpReference: type === 'Others' ? NA : val(erpRef), erpInvoice: type === 'Others' ? NA : val(erpInvoice), erpQuantity: type === 'Others' ? NA : val(erpQty), erpRate: type === 'Others' ? NA : val(erpRate),
    // Credit/Debit Note's own BillValue, flat 5% GST, and the resulting
    // Total Supplier Bill Value — see the interState/billSgstScaled note
    // above for why BillValue (not the note's "Value" column) is used.
    erpBillValue: settlementApplicable ? val(cdn?.billValue) : NA,
    erpGst: settlementApplicable ? val(billSgstScaled != null || billCgstScaled != null ? (billSgstScaled ?? 0) + (billCgstScaled ?? 0) : null) : NA,
    erpIgst: settlementApplicable ? val(billIgstScaled) : NA,
    erpTotalValue: settlementApplicable ? val(billTotal) : NA,
    qcReference: oilApplicable || qcRows.length ? val(qcRows[0]?.referenceNo) : NA, qcOil: oilApplicable ? val(oil.qcOil) : NA, jmdOil: oilApplicable ? val(oil.jmdOil) : NA, jmdRate: settlementApplicable ? val(cdn?.finalRate) : NA, oilDifference: oilApplicable ? val(oil.oilDifference) : NA,
    cndnNumber: settlementApplicable ? val(cdn?.referenceNumber) : NA, settlementReference: settlementApplicable ? val(stRows[0]?.referenceNo ?? cdn?.referenceNumber) : NA,
    settlementWeight: settlementApplicable ? val(cdn?.finalWeight ?? stRows[0]?.quantity) : NA, billRate: settlementApplicable ? val(cdn?.billRate) : NA, finalRate: settlementApplicable ? val(cdn?.finalRate) : NA,
    billValue: settlementApplicable ? val(cdn?.billValue) : NA,
    billSgst: settlementApplicable ? val(billSgstScaled) : NA, billCgst: settlementApplicable ? val(billCgstScaled) : NA, billIgst: settlementApplicable ? val(billIgstScaled) : NA,
    rebate: settlementApplicable ? val(cdn?.rebateValue) : NA,
    rebateSgst: settlementApplicable ? val(cdn?.rebateSgst) : NA, rebateCgst: settlementApplicable ? val(cdn?.rebateCgst) : NA, rebateIgst: settlementApplicable ? val(cdn?.rebateIgst) : NA,
    // Signed so the sheet reads as one straight addition: Bill Value + GST +
    // CN/DN Adjustment − Weighing − Unloading − TDS = Settlement Net Value.
    // Positive for a Credit Note reference (CN-...), negative for a Debit
    // Note reference (DN-...).
    cndnAdjustment: settlementApplicable ? val(rebateSigned) : NA,
    weighingCharges: settlementApplicable ? val(cdn?.weightment) : NA, unloadingCharges: settlementApplicable ? val(cdn?.unloading) : NA, tdsAmount: settlementApplicable ? val(cdn?.tds) : NA,
    settlementNetValue: settlementApplicable ? val(settlementNet) : NA,
    resettlementReference: NA, revisedWeight: NA, revisedRate: NA, revisedAdjustment: NA, revisedNetValue: NA,
    tallyVoucherDate: tallyNotExpected && !booking ? NA : val(tallyDate), tallyVoucherType: tallyNotExpected && !booking ? NA : val(tallyType), tallyVoucherNo: tallyNotExpected && !booking ? NA : val(tallyNo), tallyAgstRef: payList.length ? payList.map(p => p.ref.ref).join(' | ') : isPurchase || nonStock ? NOT_FOUND : NA,
    tallyParty: tallyNotExpected && !booking ? NA : val(tallyParty), tallyDebit: booking ? val(tv?.debit) : tallyNotExpected ? NA : NOT_FOUND, tallyCredit: booking ? val(tallyCreditAmt) : tallyNotExpected ? NA : NOT_FOUND, tallyAmount: booking ? val(tallyAmount) : tallyNotExpected ? NA : NOT_FOUND,
    tallyPaymentVoucher: payList.length ? [...new Set(payList.map(p => p.voucher.vchNo))].join(', ') : isPurchase || nonStock ? NOT_FOUND : NA, tallyPaymentDate: payList.length ? payList[0].voucher.date : isPurchase || nonStock ? NOT_FOUND : NA, tallyPaymentAmount: payList.length ? val(payTotal) : isPurchase || nonStock ? NOT_FOUND : NA,
    paymentStatus,
    // Bags and weights after bags. Purchases only; N/A where no source carries a bag count.
    juteBags: bagsKnown ? val(juteBags ?? 0) : NA, plasticBags: bagsKnown ? val(plasticBags ?? 0) : NA, totalBags: bagsKnown ? val(totalBags) : NA,
    bagWeightKg: bagsKnown ? Number((juteKg + plasticKg).toFixed(3)) : NA, netAfterBags: isPurchase && qtyComparable ? val(netAfterBagsMt) : NA, weightBasis: isPurchase && erpQty != null && qtyComparable ? chosenBasis.label : NA,
    packRate: settlementApplicable ? val(gunnyRate) : NA, gunnyCost: settlementApplicable ? val(gunnyCost) : NA,
    settlementWeightDiff: settlementApplicable ? val(settlementWtDiff) : NA, settlementWeightDiffValue: settlementApplicable ? val(settlementWtDiffValue) : NA,
    tallySettlementValue: settlementApplicable ? val(tallyNet) : NA, settlementValueDiff: settlementApplicable ? val(tallyDiff) : NA,
    balanceToSettle: settlementApplicable ? (balanceToSettle != null && (advanceCase || payMismatch) ? balanceToSettle : payAmount != null ? 0 : NOT_FOUND) : NA, settlementCheck,
    dataQuality: flags.length ? flags.join('; ') : 'OK',
    quantityDifference: qtyComparable ? val(qtyDiff) : NA, amountDifference: val(amtDiff), paymentDifference: settlementApplicable ? val(payDiff) : NA,
    ...salesFields,
    saleType, weighmentParty: w.party || NOT_FOUND, weighmentStatus,
    matchConfidence: confidence, matchMethod: methods.join(' · ') || NOT_FOUND, exceptionCategory: exceptionOnly.length ? exceptionOnly[0] : primaryStatus === 'FULLY MATCHED' ? NA : primaryStatus, aiComment: parts.join(' '),
  };
  // An Inter/Job Work row that carries an ERP sales invoice is also shown on the SALES sheet, laid out as a sale. Nothing about the row itself changes.
  let salesView: Record<string, string | number> | undefined;
  if (type === 'Inter/Job Work' && invoice) salesView = { ...v, transactionType: 'Sales', ...salesDebtorFields(invoice, ledger, product.masterProductName || w.material || '', w.party).fields };
  return { reconId, runId, transactionType: displayType, primaryStatus, statuses: finalStatuses, v, product, audit, erpProductRaw: erpProductRaw || undefined, ...(salesView ? { salesView } : {}) };
}
