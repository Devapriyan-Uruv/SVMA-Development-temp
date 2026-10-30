import type { ProductMatch } from './productMaster';

// ONE master dataset: one transaction = one Recon ID = one row. The column
// list below is the single source of truth for the on-screen table AND every
// Excel sheet — the filtered views are the same rows, never re-reconciled.
// Every cell is a number or one of the two explicit strings the spec
// requires ('Not Found' = expected but not located, 'N/A' = does not apply);
// nothing is ever left blank.

export type Section = 'CONTROL' | 'SALES - DEBTORS DETAILS' | 'QUALITY CUT DETAILS' | 'GUNNIES' | 'WEIGHMENT/GATE' | 'ERP' | 'QC' | 'SETTLEMENT' | 'RESETTLEMENT' | 'TALLY' | 'VARIANCE' | 'AI';
export type Fmt = 'text' | 'date' | 'money' | 'qty' | 'pct' | 'int';
// `src` = which master value feeds the column when it differs from `key` (a layout can show the
// same value under another heading); `blank` = a column the layout needs but we have no data for yet.
export type Col = { key: string; label: string; section: Section; fmt: Fmt; width: number; freeze?: boolean; src?: string; blank?: boolean; allowEmpty?: boolean };

const c = (section: Section, key: string, label: string, fmt: Fmt, width: number, freeze = false): Col => ({ key, label, section, fmt, width, freeze });

export const COLUMNS: Col[] = [
  c('CONTROL', 'reconId', 'Recon ID', 'text', 20, true),
  c('CONTROL', 'gatePass', 'Gate Pass', 'text', 17, true),
  c('CONTROL', 'vehicle', 'Vehicle', 'text', 14, true),
  c('CONTROL', 'transactionType', 'Transaction Type', 'text', 14),
  c('CONTROL', 'date', 'Date', 'date', 12),
  c('CONTROL', 'reconStatus', 'Recon Status', 'text', 18),
  c('CONTROL', 'exceptions', 'All Exceptions', 'text', 34),
  c('CONTROL', 'runId', 'Reconciliation Run ID', 'text', 20),
  c('WEIGHMENT/GATE', 'party', 'Supplier/Customer', 'text', 28),
  c('WEIGHMENT/GATE', 'material', 'Material (source)', 'text', 26),
  c('WEIGHMENT/GATE', 'productMaster', 'Product Master Product', 'text', 26),
  c('WEIGHMENT/GATE', 'productCategory', 'Product Master Category', 'text', 18),
  c('WEIGHMENT/GATE', 'productMethod', 'Product Match Method', 'text', 14),
  c('WEIGHMENT/GATE', 'productConfidence', 'Product Match Confidence', 'pct', 12),
  c('WEIGHMENT/GATE', 'supplierInvoice', 'Supplier Invoice', 'text', 16),
  c('WEIGHMENT/GATE', 'po', 'PO', 'text', 18),
  c('WEIGHMENT/GATE', 'so', 'SO', 'text', 20),
  c('WEIGHMENT/GATE', 'lot', 'Lot Number', 'text', 22),
  c('WEIGHMENT/GATE', 'grossWeight', 'Gross Weight (kg)', 'qty', 14),
  c('WEIGHMENT/GATE', 'tareWeight', 'Tare Weight (kg)', 'qty', 14),
  c('WEIGHMENT/GATE', 'netWeight', 'Net Weight (kg)', 'qty', 14),
  // Bags on the load and what the ERP/settlement weights are measured after (jute 1 kg/bag, plastic 0.2 kg/bag where carried).
  c('GUNNIES', 'juteBags', 'Jute Bags', 'int', 11),
  c('GUNNIES', 'plasticBags', 'Plastic Bags', 'int', 11),
  c('GUNNIES', 'totalBags', 'Total Bags', 'int', 11),
  c('GUNNIES', 'bagWeightKg', 'Bag Weight (kg)', 'qty', 13),
  c('GUNNIES', 'netAfterBags', 'Weighbridge Net After Bags (MT)', 'qty', 17),
  c('GUNNIES', 'weightBasis', 'ERP Weight Basis', 'text', 18),
  c('GUNNIES', 'packRate', 'Gunny Rate (₹/bag)', 'money', 13),
  c('GUNNIES', 'gunnyCost', 'Gunny Cost', 'money', 13),
  c('ERP', 'erpReference', 'ERP Reference', 'text', 20),
  c('ERP', 'erpInvoice', 'ERP Invoice', 'text', 18),
  c('ERP', 'erpQuantity', 'ERP Quantity (MT)', 'qty', 14),
  c('ERP', 'erpRate', 'ERP Rate', 'money', 12),
  // Credit/Debit Note's own BillValue (its "BillValue" column, confirmed
  // the actual invoiced figure — matches ERP Amount, unlike its "Value"
  // column) plus a flat 5% GST, giving the real total the supplier billed.
  // Purchase only; N/A for Sales/Others. No separate "ERP Amount" column —
  // this IS that figure now, sourced from the Credit/Debit Note directly
  // rather than a second, often-inconsistent copy from Purchase Register.
  c('ERP', 'erpBillValue', 'Bill Value', 'money', 15),
  c('ERP', 'erpGst', 'GST', 'money', 11),
  c('ERP', 'erpIgst', 'IGST', 'money', 11),
  c('ERP', 'erpTotalValue', 'Total Supplier Bill Value', 'money', 20),
  c('QC', 'qcReference', 'QC Reference', 'text', 18),
  c('QC', 'qcOil', 'QC Oil %', 'pct', 11),
  c('QC', 'jmdOil', 'JMD/Report Oil %', 'pct', 13),
  c('QC', 'jmdRate', 'JMD Rate', 'money', 12),
  c('SETTLEMENT', 'cndnNumber', 'CN/DN Number', 'text', 16),
  c('SETTLEMENT', 'settlementReference', 'Settlement Reference', 'text', 18),
  c('SETTLEMENT', 'settlementWeight', 'Settlement Weight (MT)', 'qty', 14),
  c('SETTLEMENT', 'settlementWeightDiff', 'Settlement Weight − Net After Jute (MT)', 'qty', 18),
  c('SETTLEMENT', 'settlementWeightDiffValue', 'Settlement Weight Difference (₹)', 'money', 17),
  c('SETTLEMENT', 'billRate', 'Bill Rate', 'money', 12),
  c('SETTLEMENT', 'finalRate', 'Final Rate', 'money', 12),
  c('SETTLEMENT', 'billValue', 'Bill Value', 'money', 15),
  // CN/DN's bill-side GST (SGST/CGST/IGST tied to Value) and rebate-side
  // GST (SGST/CGST/IGST tied to Rebate Value) — the note's own two real
  // GST computations, each shown next to the figure it belongs to.
  c('SETTLEMENT', 'billSgst', 'SGST', 'money', 11),
  c('SETTLEMENT', 'billCgst', 'CGST', 'money', 11),
  c('SETTLEMENT', 'billIgst', 'IGST', 'money', 11),
  c('SETTLEMENT', 'rebate', 'Rebate', 'money', 13),
  c('SETTLEMENT', 'rebateSgst', 'SGST', 'money', 11),
  c('SETTLEMENT', 'rebateCgst', 'CGST', 'money', 11),
  c('SETTLEMENT', 'rebateIgst', 'IGST', 'money', 11),
  c('SETTLEMENT', 'cndnAdjustment', 'CN/DN Adjustment', 'money', 15),
  c('SETTLEMENT', 'weighingCharges', 'WEIGHING CHARGES', 'money', 14),
  c('SETTLEMENT', 'unloadingCharges', 'UNLOADING CHARGES', 'money', 14),
  c('SETTLEMENT', 'tdsAmount', 'TDS', 'money', 11),
  c('SETTLEMENT', 'settlementNetValue', 'Settlement Net Value', 'money', 16),
  c('SETTLEMENT', 'tallySettlementValue', 'Tally Settlement Value', 'money', 17),
  c('SETTLEMENT', 'settlementValueDiff', 'Tally − Note Difference', 'money', 16),
  c('SETTLEMENT', 'balanceToSettle', 'Balance To Settle', 'money', 15),
  c('SETTLEMENT', 'settlementCheck', 'Settlement Check', 'text', 52),
  c('RESETTLEMENT', 'resettlementReference', 'Resettlement Reference', 'text', 18),
  c('RESETTLEMENT', 'revisedWeight', 'Revised Weight', 'qty', 13),
  c('RESETTLEMENT', 'revisedRate', 'Revised Rate', 'money', 13),
  c('RESETTLEMENT', 'revisedAdjustment', 'Revised Adjustment', 'money', 15),
  c('RESETTLEMENT', 'revisedNetValue', 'Revised Net Value', 'money', 15),
  c('TALLY', 'tallyVoucherDate', 'Tally Voucher Date', 'date', 13),
  c('TALLY', 'tallyVoucherType', 'Tally Voucher Type', 'text', 22),
  c('TALLY', 'tallyVoucherNo', 'Tally Voucher No.', 'text', 20),
  c('TALLY', 'tallyAgstRef', 'Tally Agst Ref', 'text', 30),
  c('TALLY', 'tallyParty', 'Tally Party', 'text', 28),
  c('TALLY', 'tallyDebit', 'Tally Debit', 'money', 14),
  c('TALLY', 'tallyCredit', 'Tally Credit', 'money', 14),
  c('TALLY', 'tallyAmount', 'Tally Amount', 'money', 14),
  c('TALLY', 'tallyPaymentVoucher', 'Tally Payment Voucher', 'text', 18),
  c('TALLY', 'tallyPaymentDate', 'Tally Payment Date', 'date', 13),
  c('TALLY', 'tallyPaymentAmount', 'Tally Payment Amount', 'money', 15),
  c('TALLY', 'paymentStatus', 'Payment Status', 'text', 18),
  c('VARIANCE', 'quantityDifference', 'Quantity Difference (MT)', 'qty', 14),
  c('VARIANCE', 'amountDifference', 'Amount Difference', 'money', 15),
  c('VARIANCE', 'paymentDifference', 'Payment Difference', 'money', 15),
  c('AI', 'matchConfidence', 'Match Confidence', 'pct', 11),
  c('AI', 'matchMethod', 'Match Method', 'text', 38),
  c('AI', 'exceptionCategory', 'Exception Category', 'text', 26),
  c('AI', 'dataQuality', 'Data Quality Flags', 'text', 40),
  c('AI', 'aiComment', 'AI Reconciliation Comment', 'text', 90),
];

export const SECTION_COLORS: Record<Section, string> = {
  CONTROL: '1F3A5F', 'SALES - DEBTORS DETAILS': '1F3A5F', 'QUALITY CUT DETAILS': '9A3B3B', GUNNIES: '7A5C1E', 'WEIGHMENT/GATE': '2B6F77', ERP: '5B4B9A', QC: '8A5A00', SETTLEMENT: '9A3B3B', RESETTLEMENT: '6B6B6B', TALLY: '2F6B3A', VARIANCE: 'A0522D', AI: '3D3D8A',
};

// ---- Direct / Indirect Purchase layouts -------------------------------------
// Same rows and values as the main sheet, arranged to the Finance templates
// ("Direct Purchase - RB NEW", "INDIRECT PURCHASE - RB NEW"). A [label, null]
// entry is a column the template needs but nothing feeds yet — it stays empty.
type Spec = [section: Section, label: string, src: string | null];
const BY_KEY = new Map(COLUMNS.map(col => [col.key, col]));
function layout(prefix: string, specs: Spec[], extra: Record<string, { fmt: Fmt; empty?: boolean }> = {}): Col[] {
  return specs.map(([section, label, src], i) => {
    const base = src ? BY_KEY.get(src) : undefined, ex = src ? extra[src] : undefined;
    return { key: `${prefix}${i}`, label, section, fmt: ex?.fmt ?? base?.fmt ?? 'text', width: base?.width ?? Math.max(14, Math.min(26, label.length + 4)), freeze: i < 3, src: src ?? undefined, blank: !src, allowEmpty: ex?.empty };
  });
}
const CTRL_HEAD: Spec[] = [['CONTROL', 'Recon ID', 'reconId'], ['CONTROL', 'Gate Pass', 'gatePass'], ['CONTROL', 'Vehicle', 'vehicle']];
const WG_COMMON: Spec[] = [
  ['WEIGHMENT/GATE', 'Supplier/Customer', 'party'], ['WEIGHMENT/GATE', 'Material (source)', 'material'], ['WEIGHMENT/GATE', 'Product Master Product', 'productMaster'],
  ['WEIGHMENT/GATE', 'Product Master Category', 'productCategory'], ['WEIGHMENT/GATE', 'Product Match Method', 'productMethod'], ['WEIGHMENT/GATE', 'Product Match Confidence', 'productConfidence'],
  ['WEIGHMENT/GATE', 'Supplier Invoice', 'supplierInvoice'],
];
const WG_TAIL: Spec[] = [
  ['WEIGHMENT/GATE', 'PO', 'po'], ['WEIGHMENT/GATE', 'SO', 'so'], ['WEIGHMENT/GATE', 'Lot Number', 'lot'],
  ['WEIGHMENT/GATE', 'Gross Weight (kg)', 'grossWeight'], ['WEIGHMENT/GATE', 'Tare Weight (kg)', 'tareWeight'], ['WEIGHMENT/GATE', 'Net Weight (kg)', 'netWeight'],
];
const AI_TAIL: Spec[] = [['AI', 'Match Confidence', 'matchConfidence'], ['AI', 'Match Method', 'matchMethod'], ['AI', 'Exception Category', 'exceptionCategory'], ['AI', 'Data Quality Flags', 'dataQuality'], ['AI', 'AI Reconciliation Comment', 'aiComment']];
// Added after the Finance template's own columns (so the template's column positions are untouched): weights after bags,
// gunny cost, and the settlement cross-checks.
const CHECK_TAIL: Spec[] = [
  ['GUNNIES', 'Weighbridge Net After Bags (MT)', 'netAfterBags'], ['GUNNIES', 'ERP Weight Basis', 'weightBasis'], ['GUNNIES', 'Bag Weight (kg)', 'bagWeightKg'],
  ['GUNNIES', 'Gunny Rate (₹/bag)', 'packRate'], ['GUNNIES', 'Gunny Cost', 'gunnyCost'],
  ['SETTLEMENT', 'Settlement Weight − Net After Jute (MT)', 'settlementWeightDiff'], ['SETTLEMENT', 'Settlement Weight Difference (₹)', 'settlementWeightDiffValue'],
  ['SETTLEMENT', 'Tally Settlement Value', 'tallySettlementValue'], ['SETTLEMENT', 'Tally − Note Difference', 'settlementValueDiff'], ['SETTLEMENT', 'Balance To Settle', 'balanceToSettle'], ['SETTLEMENT', 'Settlement Check', 'settlementCheck'],
  ['TALLY', 'Payment Status', 'paymentStatus'],
];

export const DIRECT_COLUMNS: Col[] = layout('d', [
  ...CTRL_HEAD, ['CONTROL', 'Transaction Type', 'transactionType'], ['CONTROL', 'Date', 'date'], ['CONTROL', 'Recon Status', 'reconStatus'], ['CONTROL', 'All Exceptions', 'exceptions'], ['CONTROL', 'Reconciliation Run ID', 'runId'],
  ...WG_COMMON, ['WEIGHMENT/GATE', 'DIRECT PURCHASE', 'transactionType'], ...WG_TAIL,
  ['ERP', 'ERP Reference No', 'erpReference'], ['ERP', 'ERP Invoice', 'erpInvoice'], ['ERP', 'PARTY INVOICE  WEIGHT', null], ['ERP', 'PARTY BILL  Rate', 'erpRate'],
  ['ERP', 'Party Bill ASS Value', 'erpBillValue'], ['ERP', 'IGST', 'erpIgst'], ['ERP', 'CGST', 'billCgst'], ['ERP', 'SGST', 'billSgst'], ['ERP', 'Party  Bill Total Value ( Incl GST)', 'erpTotalValue'],
  ['QC', 'QC Reference No', 'qcReference'], ['QC', 'QC Oil %', 'qcOil'],
  ['SETTLEMENT', 'TDS (Less)', 'tdsAmount'], ['SETTLEMENT', 'Settlement Total Value', 'settlementNetValue'], ['SETTLEMENT', 'Other Expenses', null], ['SETTLEMENT', 'Cooli Expenses', null],
  ['TALLY', 'Tally Voucher No', 'tallyVoucherNo'], ['TALLY', 'Tally Reference No', 'tallyAgstRef'], ['TALLY', 'Tally Payment Date', 'tallyPaymentDate'], ['TALLY', 'Tally Payment Amount', 'tallyPaymentAmount'],
  ['GUNNIES', 'JUTE BAGS', 'juteBags'], ['GUNNIES', 'PLASTIC BAGS', 'plasticBags'], ['GUNNIES', 'TOTAL BAGS', 'totalBags'],
  ...CHECK_TAIL,
  ...AI_TAIL,
]);

export const INDIRECT_COLUMNS: Col[] = layout('i', [
  ...CTRL_HEAD, ['CONTROL', 'Date', 'date'], ['CONTROL', 'Recon Status', 'reconStatus'], ['CONTROL', 'All Exceptions', 'exceptions'], ['CONTROL', 'Reconciliation Run ID', 'runId'],
  ...WG_COMMON, ['WEIGHMENT/GATE', 'INDIRECT PURCHASE', 'transactionType'], ...WG_TAIL,
  ['ERP', 'ERP Reference', 'erpReference'], ['ERP', 'PARTY INVOICE NO', 'erpInvoice'], ['ERP', 'PARTY INVOICE WEIGHT (MT)', null],
  ['GUNNIES', 'JUTE', 'juteBags'], ['GUNNIES', 'PLASTIC', 'plasticBags'], ['GUNNIES', 'TOTAL', 'totalBags'],
  ['ERP', 'ERP GRN WEIGHT', 'erpQuantity'], ['ERP', 'ERP PO RATE', 'erpRate'], ['ERP', 'PARTY BILL ASS VALUE', 'erpBillValue'],
  ['ERP', 'IGST', 'erpIgst'], ['ERP', 'CGST', 'billCgst'], ['ERP', 'SGST', 'billSgst'], ['ERP', 'PARTY BILL TOTAL VALUE (Incl GST)', 'erpTotalValue'],
  ['QC', 'QC Reference', 'qcReference'], ['QC', 'QC Oil %', 'qcOil'], ['QC', 'JMD/Report Oil %', 'jmdOil'], ['QC', 'JMD FINAL RATE', 'jmdRate'],
  ['SETTLEMENT', 'CN/DN Number', 'cndnNumber'], ['SETTLEMENT', 'Settlement Weight (MT)', 'settlementWeight'], ['SETTLEMENT', 'REBATE VALUE (ASS VALUE)', 'rebate'],
  ['SETTLEMENT', 'IGST ', 'rebateIgst'], ['SETTLEMENT', 'CGST', 'rebateCgst'], ['SETTLEMENT', 'SGST', 'rebateSgst'], ['SETTLEMENT', 'CN/DN TOTAL VALUE (Incl GST)', 'cndnAdjustment'],
  ['SETTLEMENT', 'WEIGHING CHARGES', 'weighingCharges'], ['SETTLEMENT', 'UNLOADING CHARGES', 'unloadingCharges'], ['SETTLEMENT', 'TDS', 'tdsAmount'], ['SETTLEMENT', 'Settlement Net Value', 'settlementNetValue'],
  ['RESETTLEMENT', 'Resettlement Reference', null], ['RESETTLEMENT', 'CN/DN NOTE', null], ['RESETTLEMENT', 'IGST', null], ['RESETTLEMENT', 'CGST', null], ['RESETTLEMENT', 'SGST', null],
  ['RESETTLEMENT', 'CN/DN TOTAL VALUE', null],
  ['TALLY', 'Tally Voucher Type', 'tallyVoucherType'], ['TALLY', 'Tally Voucher No.', 'tallyVoucherNo'], ['RESETTLEMENT', 'RESETTLEMENT TOTAL VALUE', null],
  ['TALLY', 'Tally VOUCHER DATE', 'tallyVoucherDate'], ['TALLY', 'Tally Debit', 'tallyDebit'], ['TALLY', 'Tally  Ref No', 'tallyAgstRef'],
  ['TALLY', 'Tally Payment Date', 'tallyPaymentDate'], ['TALLY', 'Tally Payment Amount', 'tallyPaymentAmount'],
  ...CHECK_TAIL,
  ...AI_TAIL,
]);

// SALES — the client's "SALES - DEBTORS DETAILS" format (SVMA SALES -AI.xlsx), 30 columns in
// that order. LOCAL SALES, TDS and WEIGHT SHORTAGE are in the format but have no source yet, so
// they stay empty. Receipts / quality cut are empty (not "Not Found") when there is none.
const SALES_EXTRA: Record<string, { fmt: Fmt; empty?: boolean }> = {
  salesAssValue: { fmt: 'money' }, salesIgst: { fmt: 'money' }, salesCgst: { fmt: 'money' }, salesSgst: { fmt: 'money' }, salesInvoiceTotal: { fmt: 'money' },
  receipt1Date: { fmt: 'date', empty: true }, receipt1Amount: { fmt: 'money', empty: true }, receipt2Date: { fmt: 'date', empty: true }, receipt2Amount: { fmt: 'money', empty: true },
  receipt3Date: { fmt: 'date', empty: true }, receipt3Amount: { fmt: 'money', empty: true },
  qualityCutAmount: { fmt: 'money', empty: true }, qualityCutRef: { fmt: 'text', empty: true }, qualityCutTotal: { fmt: 'money', empty: true },
  balanceBeforeCut: { fmt: 'money', empty: true }, balanceAfterCut: { fmt: 'money', empty: true },
};
const SD = 'SALES - DEBTORS DETAILS' as const, QC = 'QUALITY CUT DETAILS' as const;
export const SALES_COLUMNS: Col[] = layout('s', [
  [SD, 'DATE', 'date'], [SD, 'ERP GATE PASS', 'gatePass'], [SD, 'LOCAL SALES', null], [SD, 'MATERIAL NAME', 'salesMaterial'], [SD, 'Sales Order  NO', 'so'],
  [SD, 'ERP REFERENCE NO', 'erpReference'], [SD, 'Invoice N0', 'erpInvoice'], [SD, 'PARTY  NAME', 'salesInvoiceParty'], [SD, 'VEHICLE NO', 'vehicle'], [SD, 'PLACE', 'salesPlace'], [SD, 'RATE', 'erpRate'],
  [SD, 'GROSS WEIGHT', 'grossWeight'], [SD, 'TARE WEIGHT', 'tareWeight'], [SD, 'NET WEIGHT', 'netWeight'],
  [SD, 'BILL AMOUNT (Ass Value)', 'salesAssValue'], [SD, 'IGST', 'salesIgst'], [SD, 'CGST', 'salesCgst'], [SD, 'SGST', 'salesSgst'], [SD, 'TDS', null],
  [SD, 'INVOICE TOTAL AMOUNT', 'salesInvoiceTotal'], [SD, 'TALLY REFERANCE NO', 'tallyVoucherNo'],
  [SD, '1.RECEIPT DATE', 'receipt1Date'], [SD, '1.RECEIPT AMOUNT', 'receipt1Amount'], [SD, '2.RECEIPT DATE', 'receipt2Date'], [SD, '2.RECEIPT AMOUNT', 'receipt2Amount'],
  [SD, '3.RECEIPT DATE', 'receipt3Date'], [SD, '3.RECEIPT AMOUNT', 'receipt3Amount'],
  [QC, 'WEIGHT SHORTAGE', null], [QC, 'QUALITY CUT AMOUNT', 'qualityCutAmount'], [QC, 'QUALITY CUT REFERANCE NO', 'qualityCutRef'], [QC, 'QUALITY CUT TOTAL AMOUNT', 'qualityCutTotal'], [QC, 'BALANCE BEFORE QUALITY CUT', 'balanceBeforeCut'], [QC, 'BALANCE AFTER QUALITY CUT', 'balanceAfterCut'],
  [SD, 'SALE TYPE', 'saleType'], [SD, 'WEIGHMENT PARTY (DELIVERED TO)', 'weighmentParty'], [SD, 'WEIGHMENT', 'weighmentStatus'],
  ['AI', 'AI COMMENTS', 'aiComment'],
], SALES_EXTRA);

/** Columns for the on-screen table and the type's own Excel sheet. */
export function columnsFor(type: string): Col[] {
  return type === 'Direct Purchase' ? DIRECT_COLUMNS : type === 'Indirect Purchase' ? INDIRECT_COLUMNS : type === 'Sales' ? SALES_COLUMNS : COLUMNS;
}

export const NOT_FOUND = 'Not Found';
export const NA = 'N/A';

// Order = priority: the primary status of a row is the first one present.
export const STATUS_PRIORITY = [
  'REVIEW REQUIRED', 'NOT MATCHED', 'OIL MISMATCH', 'AMOUNT MISMATCH', 'QUANTITY MISMATCH',
  'ERP MISSING', 'QC MISSING', 'SETTLEMENT PENDING', 'RESETTLEMENT PENDING', 'CN/DN PENDING', 'TALLY MISSING',
  'PARTIAL MATCH', 'FULLY MATCHED',
] as const;
export type ReconStatus = typeof STATUS_PRIORITY[number];

export type AuditEntry = {
  stage: string; field: string; rawValue: string; normalizedValue: string;
  origin: 'upload' | 'operations_db' | 'derived';
  sourceFile: string; sourceSheet: string; sourceRow: string;
  rule: string; confidence: number; runId: string;
};

export type MasterRow = {
  reconId: string; runId: string;
  // 'Purchase' on its own = a purchase whose Credit/Debit Note (the only source
  // of Direct vs Indirect) was not found, so the type could not be identified.
  transactionType: 'Purchase' | 'Direct Purchase' | 'Indirect Purchase' | 'Sales' | 'Inter/Job Work' | 'Others';
  primaryStatus: ReconStatus; statuses: ReconStatus[];
  v: Record<string, string | number>;
  product: ProductMatch;
  audit: AuditEntry[];
  /** The linked ERP record's own product text (receipt / invoice) — the engine uses it when the weighbridge text matches no Product Master product. */
  erpProductRaw?: string;
  /** Set on an Inter/Job Work row that carries an ERP sales invoice: the same row laid out as a sale, for the SALES sheet / Sales view only. The row itself (type, status, every other sheet) is unchanged. */
  salesView?: Record<string, string | number>;
};

export type ReportUnderstanding = { file: string; detectedType: string | null; label: string; confidence: number; method: string; sheet: string; rows: number; status: 'used' | 'unrecognized' | 'error'; note: string };

export type OneReconSummary = {
  total: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  productNotFound: number;
  /** ERP receipts / Tally purchase bookings in the run's date range that no weighment row is linked to (see `unlinked`). */
  unlinkedErp?: number; unlinkedTally?: number;
};

/** An ERP purchase receipt or Tally purchase booking dated in the run that has no weighment row. */
export type UnlinkedRecord = {
  source: 'ERP receipt' | 'Tally booking'; date: string; reference: string; lot: string; party: string; vehicle: string; product: string;
  quantityMt: number | null; amount: number | null; tallyVoucher: string; erpReceipt: string; nearestWeighments: string; reason: string;
};

export type OneReconResult = {
  runId: string; reconciliationDate: string;
  rows: MasterRow[]; summary: OneReconSummary;
  understanding: ReportUnderstanding[]; warnings: string[];
  definitions: string[];
  unlinked?: UnlinkedRecord[];
  /** ERP sales invoices in the run's dates that no weighment row is linked to (single-weight vehicles, other weighbridges). Shown on the SALES sheet / Sales view only; they are not part of `rows`, the summary or the saved run. */
  salesNoWeighment?: MasterRow[];
};

export function pickPrimary(statuses: ReconStatus[]): ReconStatus {
  return STATUS_PRIORITY.find(s => statuses.includes(s)) || 'FULLY MATCHED';
}
