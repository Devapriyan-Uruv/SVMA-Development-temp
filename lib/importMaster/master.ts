// The "Import Master" layout of the Import Tracking sheet — 49 columns, one row per invoice / shipment — built from the import records,
// plus the check for what is still empty. Every input field is wanted; a field is "needed now" once the record has reached the stage it
// belongs to ("later" fields are listed but not chased). Columns the sheet calculates (invoice INR, customs outgo, BC outstanding ...) are
// calculated here and are never asked for.

export const STAGES = ['contract_received', 'lc_opened', 'shipped', 'arrived', 'boe_filed', 'cleared', 'bc_open', 'settled', 'closed'] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = { contract_received: 'Contract', lc_opened: 'LC', shipped: 'Shipment & invoice', arrived: 'Arrival', boe_filed: 'Bill of Entry', cleared: 'Cleared', bc_open: "Buyer's Credit", settled: 'Settlement', closed: 'Closed' };
const stageIdx = (s: string) => Math.max(0, STAGES.indexOf(s as Stage));
/** How far the record really is: the stage someone set, or further if the data shows it (a Bill of Entry number means it has reached the BOE stage even if the status was never advanced). */
export function effectiveStage(e: { status?: string; [k: string]: any }): Stage {
  const has = (k: string) => e[k] !== null && e[k] !== undefined && String(e[k]).trim() !== '';
  let i = stageIdx(String(e.status || ''));
  if (has('lc_no')) i = Math.max(i, 1);
  if (has('bl_awb_no') || has('bl_date') || has('invoice_no')) i = Math.max(i, 2);
  if (has('arrival_date')) i = Math.max(i, 3);
  if (has('boe_no') || has('boe_date')) i = Math.max(i, 4);
  if (e.converted_to_bc || has('bc_no')) i = Math.max(i, 6);
  if (has('settlement_date')) i = Math.max(i, 7);
  return STAGES[i];
}

export type Entry = Record<string, any> & { trade_parties?: { name?: string; country?: string } | null; trade_commodities?: { name?: string; hsn?: string | null } | null };
type Val = string | number | null;
export type MasterCol = { no: number; label: string; get: (e: Entry, ctx: { today: string }) => Val; kind: 'input' | 'derived' | 'optional'; stage?: Stage; field?: string; when?: (e: Entry) => boolean };

const n = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const s = (v: unknown): string | null => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim());
const yn = (b: unknown) => (b ? 'Y' : 'N');
const sum = (...a: (number | null)[]) => (a.every(x => x == null) ? null : Math.round(a.reduce<number>((t, x) => t + (x ?? 0), 0) * 100) / 100);
const days = (iso: string | null, today: string) => (iso ? Math.round((Date.parse(iso) - Date.parse(today)) / 86400000) : null);
const converted = (e: Entry) => !!e.converted_to_bc;
const GOODS_STATUS: Record<string, string> = { contract_received: 'Ordered', lc_opened: 'Ordered', shipped: 'Shipped', arrived: 'Arrived', boe_filed: 'BOE filed', cleared: 'Cleared', bc_open: 'Received', settled: 'Received', closed: 'Received' };

const col = (no: number, label: string, kind: MasterCol['kind'], get: MasterCol['get'], extra: Partial<MasterCol> = {}): MasterCol => ({ no, label, kind, get, ...extra });
export const MASTER: MasterCol[] = [
  col(1, 'Sl No', 'derived', () => null),
  col(2, 'Supplier / Party Name', 'input', e => s(e.trade_parties?.name), { stage: 'contract_received', field: 'supplier' }),
  col(3, 'Country', 'input', e => s(e.country) ?? s(e.trade_parties?.country), { stage: 'contract_received', field: 'country' }),
  col(4, 'PO / Contract No', 'input', e => s(e.contract_no), { stage: 'contract_received', field: 'contract_no' }),
  col(5, 'Contract Date', 'input', e => s(e.contract_date), { stage: 'contract_received', field: 'contract_date' }),
  col(6, 'Invoice No', 'input', e => s(e.invoice_no), { stage: 'shipped', field: 'invoice_no' }),
  col(7, 'Invoice Date', 'input', e => s(e.invoice_date), { stage: 'shipped', field: 'invoice_date' }),
  col(8, 'Goods Description', 'input', e => s(e.trade_commodities?.name), { stage: 'contract_received', field: 'commodity' }),
  col(9, 'HSN', 'input', e => s(e.trade_commodities?.hsn), { stage: 'contract_received', field: 'hsn' }),
  col(10, 'Currency', 'input', e => s(e.currency), { stage: 'contract_received', field: 'currency' }),
  col(11, 'Invoice Amount FCY', 'input', e => n(e.invoice_value_fcy), { stage: 'shipped', field: 'invoice_value_fcy' }),
  col(12, 'Exchange Rate (USD R.P.T)', 'input', e => n(e.exchange_rate) ?? n(e.settlement_fx_rate), { stage: 'shipped', field: 'exchange_rate' }),
  col(13, 'Invoice Amount INR', 'derived', e => { const f = n(e.invoice_value_fcy), r = n(e.exchange_rate) ?? n(e.settlement_fx_rate); return f != null && r != null ? Math.round(f * r * 100) / 100 : null; }),
  col(14, 'LC No', 'input', e => s(e.lc_no), { stage: 'lc_opened', field: 'lc_no' }),
  col(15, 'LC Type', 'input', e => s(e.lc_type), { stage: 'lc_opened', field: 'lc_type' }),
  col(16, 'LC Opening Date', 'input', e => s(e.lc_opening_date), { stage: 'lc_opened', field: 'lc_opening_date' }),
  col(17, 'LC Expiry Date', 'input', e => s(e.lc_expiry_date), { stage: 'lc_opened', field: 'lc_expiry_date' }),
  col(18, 'LC Amount FCY', 'input', e => n(e.lc_amount_fcy), { stage: 'lc_opened', field: 'lc_amount_fcy' }),
  col(19, 'Advance Payment Y/N', 'derived', e => yn((n(e.advance_amount_fcy) ?? 0) > 0 || (n(e.advance_value_inr) ?? 0) > 0)),
  col(20, 'Advance Amount INR', 'input', e => n(e.advance_value_inr), { stage: 'contract_received', field: 'advance_value_inr', when: e => (n(e.advance_amount_fcy) ?? 0) > 0 }),
  col(21, 'Balance Under LC INR', 'derived', e => { const f = n(e.invoice_value_fcy), r = n(e.exchange_rate) ?? n(e.settlement_fx_rate); return f != null && r != null ? Math.round((f * r - (n(e.advance_value_inr) ?? 0)) * 100) / 100 : null; }),
  col(22, 'Shipment Date', 'input', e => s(e.bl_date), { stage: 'shipped', field: 'bl_date' }),
  col(23, 'BL / AWB No', 'input', e => s(e.bl_awb_no), { stage: 'shipped', field: 'bl_awb_no' }),
  col(24, 'Goods Status', 'derived', e => GOODS_STATUS[effectiveStage(e)] || 'Ordered'),
  col(25, 'Bill of Entry No', 'input', e => s(e.boe_no), { stage: 'boe_filed', field: 'boe_no' }),
  col(26, 'BOE Date', 'input', e => s(e.boe_date), { stage: 'boe_filed', field: 'boe_date' }),
  col(27, 'Assessable Value INR', 'input', e => n(e.assessable_value_inr), { stage: 'boe_filed', field: 'assessable_value_inr' }),
  col(28, 'Basic Customs Duty INR', 'input', e => n(e.basic_customs_duty_inr), { stage: 'boe_filed', field: 'basic_customs_duty_inr' }),
  col(29, 'SWS / Other Duty INR', 'input', e => n(e.sws_other_duty_inr), { stage: 'boe_filed', field: 'sws_other_duty_inr' }),
  col(30, 'Import IGST INR', 'input', e => n(e.import_igst_inr), { stage: 'boe_filed', field: 'import_igst_inr' }),
  col(31, 'Other Customs Charges INR', 'input', e => n(e.other_customs_charges_inr), { stage: 'boe_filed', field: 'other_customs_charges_inr' }),
  col(32, 'Total Customs Outgo INR', 'derived', e => sum(n(e.basic_customs_duty_inr), n(e.sws_other_duty_inr), n(e.import_igst_inr), n(e.other_customs_charges_inr))),
  col(33, 'LC Converted to BC Y/N', 'derived', e => yn(e.converted_to_bc)),
  col(34, 'BC No', 'input', e => s(e.bc_no), { stage: 'bc_open', field: 'bc_no', when: converted }),
  col(35, 'BC Conversion Date', 'input', e => s(e.bc_issue_date), { stage: 'bc_open', field: 'bc_issue_date', when: converted }),
  col(36, 'BC Principal INR', 'input', e => n(e.bc_principal_inr), { stage: 'bc_open', field: 'bc_principal_inr', when: converted }),
  col(37, 'BC Due Date', 'input', e => s(e.bc_due_date), { stage: 'bc_open', field: 'bc_due_date', when: converted }),
  col(38, 'BC Interest Rate % p.a.', 'input', e => n(e.bc_interest_rate), { stage: 'bc_open', field: 'bc_interest_rate', when: converted }),
  col(39, 'BC Interest Accrued INR', 'input', e => n(e.bc_interest_accrued_inr), { stage: 'bc_open', field: 'bc_interest_accrued_inr', when: converted }),
  col(40, 'BC Interest Paid INR', 'input', e => n(e.bc_interest_paid_inr), { stage: 'bc_open', field: 'bc_interest_paid_inr', when: converted }),
  col(41, 'BC Principal Paid INR', 'input', e => n(e.bc_principal_paid_inr), { stage: 'bc_open', field: 'bc_principal_paid_inr', when: converted }),
  col(42, 'BC Outstanding INR', 'derived', e => (converted(e) && n(e.bc_principal_inr) != null ? Math.round(((n(e.bc_principal_inr) ?? 0) - (n(e.bc_principal_paid_inr) ?? 0)) * 100) / 100 : null)),
  col(43, 'Days to Due / Overdue', 'derived', (e, c) => (converted(e) && !e.bc_closed ? days(s(e.bc_due_date), c.today) : null)),
  col(44, 'Bank Charges INR', 'input', e => sum(n(e.bill_collection_charges_inr), n(e.bc_close_charges_inr)), { stage: 'settled', field: 'bill_collection_charges_inr' }),
  col(45, 'Total Import Finance Cost INR', 'derived', e => sum(n(e.bc_interest_accrued_inr), n(e.bill_collection_charges_inr), n(e.bc_close_charges_inr))),
  col(46, 'Payment Status', 'derived', e => (e.status === 'settled' || e.status === 'closed' || s(e.settlement_date) ? 'Settled' : (n(e.advance_value_inr) ?? 0) > 0 ? 'Advance paid' : 'Pending')),
  col(47, 'Documents Complete Y/N', 'input', e => yn(e.documents_complete), { stage: 'cleared', field: 'documents_complete' }),
  col(48, 'Exceptions / Issues', 'optional', e => s(e.exceptions_notes)),
  col(49, 'CFO Comments / Action Required', 'optional', e => s(e.cfo_comments)),
];

/** Fields the record needs that are not report columns (still part of "all fields"). */
export const EXTRA_FIELDS: { field: string; label: string; stage: Stage; get: (e: Entry) => Val; when?: (e: Entry) => boolean }[] = [
  { field: 'contract_qty', label: 'Contract quantity', stage: 'contract_received', get: e => n(e.contract_qty) },
  { field: 'rate_per_ton', label: 'Rate per ton', stage: 'contract_received', get: e => n(e.rate_per_ton) },
  { field: 'payment_terms', label: 'Payment terms', stage: 'contract_received', get: e => s(e.payment_terms) },
  { field: 'shipment_period', label: 'Shipment period', stage: 'contract_received', get: e => s(e.shipment_period) },
  { field: 'port_of_loading', label: 'Port of loading', stage: 'shipped', get: e => s(e.port_of_loading) },
  { field: 'invoice_qty', label: 'Invoice quantity', stage: 'shipped', get: e => n(e.invoice_qty) },
  { field: 'arrival_date', label: 'Arrival date', stage: 'arrived', get: e => s(e.arrival_date) },
  { field: 'settlement_date', label: 'Settlement date', stage: 'settled', get: e => s(e.settlement_date) },
  { field: 'settlement_fx_rate', label: 'Settlement exchange rate', stage: 'settled', get: e => n(e.settlement_fx_rate) },
  { field: 'settlement_value_inr', label: 'Settlement value INR', stage: 'settled', get: e => n(e.settlement_value_inr) },
];

export type Missing = { field: string; label: string; stage: Stage; due: boolean; column: number | null };
/** What is empty on this record. `due` = the record has reached the stage the field belongs to (these are chased); the rest are listed as coming later. */
export function missingFields(e: Entry, today: string): Missing[] {
  const cur = stageIdx(effectiveStage(e)), out: Missing[] = [], c = { today };
  for (const m of MASTER) {
    if (m.kind !== 'input' || !m.stage || !m.field) continue;
    if (m.when && !m.when(e)) continue;
    const v = m.get(e, c);
    const empty = m.field === 'documents_complete' ? !e.documents_complete : v === null || v === '';
    if (empty) out.push({ field: m.field, label: m.label, stage: m.stage, due: stageIdx(m.stage) <= cur, column: m.no });
  }
  for (const x of EXTRA_FIELDS) { if (x.when && !x.when(e)) continue; if (x.get(e) === null) out.push({ field: x.field, label: x.label, stage: x.stage, due: stageIdx(x.stage) <= cur, column: null }); }
  return out;
}

export function masterRow(e: Entry, slNo: number, today: string): Val[] {
  return MASTER.map(m => (m.no === 1 ? slNo : m.get(e, { today })));
}
