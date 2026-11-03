import type { supabaseAdmin } from '@/lib/supabase/admin';
import { fetchAllRows } from '@/lib/supabase/fetchAll';
import type { DayBookVoucher } from '@/lib/outstanding/engine';
import { buildSettlement, parseShipmentEnd, type Invoice, type Link, type Override, type Receipt, type Settlement, type VoucherRow } from './engine';

type Db = ReturnType<typeof supabaseAdmin>;
const DAY = 86400000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const CONTRACT_DATE_FIELDS = ['shipment_end_date', 'eta_date', 'delivery_date', 'settlement_due_date', 'settled_at'] as const;

export type ContractRow = Record<string, any> & { id: string };
export type Loaded = {
  contract: ContractRow; invoices: Invoice[]; settlement: Settlement;
  dayBook: { from: string | null; to: string | null; vouchers: number; searched: { from: string; to: string } };
  keyDates: Record<(typeof CONTRACT_DATE_FIELDS)[number], string | null> & { suggestedShipmentEnd: string | null };
  record: { id: string; refCode: string } | null;
};

const firstWord = (s: string | null | undefined) => (String(s || '').split(/[^A-Za-z0-9]+/).find(w => w.length >= 4) || '').slice(0, 12);
export const toInvoice = (r: any): Invoice => ({ id: r.id, invNo: r.inv_no, invQty: r.inv_qty == null ? null : Number(r.inv_qty), ratePerTon: r.rate_per_ton == null ? null : Number(r.rate_per_ton), invValueUsd: r.inv_value_usd == null ? null : Number(r.inv_value_usd), advPaidUsd: r.adv_paid_usd == null ? null : Number(r.adv_paid_usd), boeNo: r.boe_no, boeDate: r.boe_date, assessableValue: r.assessable_value == null ? null : Number(r.assessable_value) });

// Only purchase / payment / journal / contra vouchers can carry an import's cost, so sales and receipts are not read (keeps the load small on a long Day Book).
/** Everything the Settlement page and the alerts need for one contract. The Day Book and ERP are only read for the window the contract can touch. */
export async function loadSettlement(db: Db, contractId: string): Promise<Loaded | null> {
  const { data: contract, error } = await db.from('import_contracts').select('*').eq('id', contractId).maybeSingle();
  if (error) throw error;
  if (!contract) return null;
  const [inv, lk, ov] = await Promise.all([
    db.from('import_contract_invoices').select('*').eq('contract_id', contractId).order('sort_order').order('created_at'),
    db.from('import_contract_links').select('kind,ref_key,col_key,status,invoice_id').eq('contract_id', contractId),
    db.from('import_contract_cells').select('invoice_id,col_key,value').eq('contract_id', contractId),
  ]);
  for (const r of [inv, lk, ov]) if (r.error) throw r.error;
  let invoices = (inv.data || []).map(toInvoice);
  // A contract with no invoice rows yet shows one blank row pre-filled from the contract, so the sheet is never empty.
  if (!invoices.length) invoices = [{ id: 'new', invNo: '', invQty: contract.quantity == null ? null : Number(contract.quantity), ratePerTon: contract.unit_price == null ? null : Number(contract.unit_price), invValueUsd: null, advPaidUsd: null, boeNo: null, boeDate: null, assessableValue: null }];
  // Invoice-level facts already kept on the Import record (Bill of Entry, assessable value, invoice, advance) are read from it, not typed again.
  const invRows = inv.data || [], recordIds = Array.from(new Set([contract.import_entry_id, ...invRows.map((r: any) => r.import_entry_id)].filter(Boolean)));
  const recs = recordIds.length ? await db.from('import_entries').select('id,ref_code,invoice_no,invoice_qty,invoice_value_fcy,currency,advance_amount_fcy,boe_no,boe_date,assessable_value_inr').in('id', recordIds) : { data: [] as any[] };
  const rec = new Map((recs.data || []).map((r: any) => [r.id, r]));
  const fill = (i: Invoice, rowEntryId: string | null | undefined): Invoice => {
    const e = rec.get(rowEntryId || (invRows.length <= 1 ? contract.import_entry_id : null)); if (!e) return i;
    const usd = !e.currency || e.currency === 'USD';
    return { ...i, invNo: i.invNo || e.invoice_no || '', invQty: i.invQty ?? (e.invoice_qty == null ? null : Number(e.invoice_qty)), invValueUsd: i.invValueUsd ?? (usd && e.invoice_value_fcy != null ? Number(e.invoice_value_fcy) : null), advPaidUsd: i.advPaidUsd ?? (usd && e.advance_amount_fcy != null ? Number(e.advance_amount_fcy) : null), boeNo: i.boeNo || e.boe_no || null, boeDate: i.boeDate || e.boe_date || null, assessableValue: i.assessableValue ?? (e.assessable_value_inr == null ? null : Number(e.assessable_value_inr)) };
  };
  invoices = invoices.map((i, k) => fill(i, invRows[k]?.import_entry_id));
  const record = contract.import_entry_id ? { id: contract.import_entry_id as string, refCode: (rec.get(contract.import_entry_id)?.ref_code as string) || '' } : null;

  const links: Link[] = (lk.data || []).map((x: any) => ({ kind: x.kind, refKey: x.ref_key, colKey: x.col_key, status: x.status }));
  const overrides: Override[] = (ov.data || []).map((x: any) => ({ invoiceId: x.invoice_id, colKey: x.col_key, value: x.value == null ? null : Number(x.value) }));

  const cd = Date.parse(String(contract.contract_date || ''));
  const boe = invoices.map(i => Date.parse(String(i.boeDate || ''))).filter(Number.isFinite);
  const from = iso((Number.isFinite(cd) ? cd : Math.min(Date.now() - 365 * DAY, ...boe)) - 30 * DAY), to = iso(Date.now() + DAY);

  const rows = await fetchAllRows<{ vkey: string; payload: DayBookVoucher }>((a, b) => db.from('daybook_day_vouchers').select('vkey,payload').gte('vch_date', from).lte('vch_date', to).or('vch_type.ilike.%payment%,vch_type.ilike.%purchase%,vch_type.ilike.%journal%,vch_type.ilike.%contra%').order('vch_date').order('vkey').range(a, b));
  if (rows.error) throw rows.error;
  const vouchers: VoucherRow[] = rows.data.map(r => ({ vkey: r.vkey, voucher: r.payload }));
  const [lo, hi, cnt] = await Promise.all([
    db.from('daybook_day_vouchers').select('vch_date').order('vch_date').limit(1),
    db.from('daybook_day_vouchers').select('vch_date').order('vch_date', { ascending: false }).limit(1),
    db.from('daybook_day_vouchers').select('vkey', { count: 'exact', head: true }),
  ]);

  const words = [firstWord(contract.supplier_name), firstWord(contract.erp_supplier)].filter(Boolean);
  let receipts: Receipt[] = [];
  if (words.length) {
    const r = await fetchAllRows<any>((a, b) => db.from('ops_purchase_receipts').select('rn_no,rn_date,supplier_name,product_raw,vehicle_no,weight,bill_qty,freight_amt,bill_value,po_no').gte('rn_date', iso((Number.isFinite(cd) ? cd : Date.now() - 365 * DAY) - 15 * DAY)).or(words.map(w => `supplier_name.ilike.%${w}%`).join(',')).order('rn_date').range(a, b));
    if (r.error) throw r.error;
    receipts = r.data.map(x => ({ rnNo: x.rn_no, rnDate: x.rn_date, vehicleNo: x.vehicle_no || '', supplier: x.supplier_name || '', product: x.product_raw || '', qty: Number(x.weight ?? x.bill_qty ?? 0), freightAmt: Number(x.freight_amt || 0), billValue: Number(x.bill_value || 0), poNo: x.po_no || '' }));
  }

  const settlement = buildSettlement({
    contract: { contractNumber: contract.contract_number, supplierName: contract.supplier_name, product: contract.product_material_name || '', quantity: contract.quantity == null ? null : Number(contract.quantity), uom: contract.uom, unitPrice: contract.unit_price == null ? null : Number(contract.unit_price), currency: contract.currency, contractDate: Number.isFinite(cd) ? iso(cd) : null, shipmentEnd: contract.shipment_end_date, erpSupplier: contract.erp_supplier, erpProduct: contract.erp_product },
    invoices, vouchers, receipts, links, overrides,
  });
  const keyDates = Object.fromEntries(CONTRACT_DATE_FIELDS.map(k => [k, contract[k] ?? null])) as Loaded['keyDates'];
  keyDates.suggestedShipmentEnd = parseShipmentEnd(contract.shipment_date_period);
  return { contract, invoices, settlement, record, dayBook: { from: lo.data?.[0]?.vch_date ?? null, to: hi.data?.[0]?.vch_date ?? null, vouchers: cnt.count ?? 0, searched: { from, to } }, keyDates };
}
