import { supabaseAdmin } from '@/lib/supabase/admin';
import { fetchAllRows } from '@/lib/supabase/fetchAll';
import { lotOfRef, type ErpInputs, type ErpNote, type History } from './build';
import type { ErpDay, ErpPending, ErpWeighment } from './loads';
import type { CompactVoucher } from '@/lib/outstanding/engine';

const norm = (s: unknown) => String(s ?? '').toUpperCase().replace(/\s+/g, '');
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const maxDate = (xs: unknown[]) => xs.map(x => String(x ?? '').slice(0, 10)).filter(Boolean).sort().pop() || '';

/** The ERP records the day is checked against: credit/debit notes, purchase receipts and the sales register, as last uploaded. */
export async function loadErpInputs(): Promise<ErpInputs> {
  const db = supabaseAdmin();
  const [notes, receipts, invoices] = await Promise.all([
    fetchAllRows<any>((a, b) => db.from('ops_credit_debit_notes').select('reference_number,date,lot_no,rebate_net_value,net_value,advance,created_at').order('created_at').range(a, b)),
    fetchAllRows<any>((a, b) => db.from('ops_purchase_receipts').select('rn_no,rn_date,lot_no,supplier_name,bill_value').order('created_at').range(a, b)),
    fetchAllRows<any>((a, b) => db.from('ops_sales_invoices').select('invoice_no,invoice_date,party_name,total_invoice_amount').order('created_at').range(a, b)),
  ]);
  for (const r of [notes, receipts, invoices]) if (r.error) throw r.error;
  const byRef = new Map<string, ErpNote>();
  for (const r of notes.data) {
    const ref = String(r.reference_number || '').trim(); if (!ref) continue;
    byRef.set(norm(ref), { ref, date: String(r.date || '').slice(0, 10), settlement: Math.round(((num(r.net_value) ?? 0) + (num(r.advance) ?? 0)) * 100) / 100, deduction: num(r.rebate_net_value) ?? 0, advance: num(r.advance) ?? 0, lot: norm(r.lot_no) });
  }
  const notesByLot = new Map<string, ErpNote[]>();
  for (const n of byRef.values()) if (n.lot) (notesByLot.get(n.lot) || notesByLot.set(n.lot, []).get(n.lot)!).push(n);
  for (const l of notesByLot.values()) l.sort((a, b) => a.date.localeCompare(b.date));
  const receiptByRn = new Map<string, { billValue: number | null; supplier: string; lot: string }>();
  for (const r of receipts.data) if (r.rn_no) receiptByRn.set(norm(r.rn_no), { billValue: num(r.bill_value), supplier: String(r.supplier_name || ''), lot: norm(r.lot_no) });
  // The invoice total is repeated on every line of an invoice: take it once.
  const invoiceByNo = new Map<string, { total: number; party: string }>();
  for (const r of invoices.data) { const k = norm(r.invoice_no); if (k && !invoiceByNo.has(k)) invoiceByNo.set(k, { total: num(r.total_invoice_amount) ?? 0, party: String(r.party_name || '') }); }
  return { notesByLot, notesByRef: byRef, receiptByRn, invoiceByNo, asOf: { receipts: maxDate(receipts.data.map((r: any) => r.rn_date)), sales: maxDate(invoices.data.map((r: any) => r.invoice_date)), notes: maxDate(notes.data.map((r: any) => r.date)), salesFrom: invoices.data.map((r: any) => String(r.invoice_date ?? '').slice(0, 10)).filter(Boolean).sort()[0] || '' } };
}

/** What has already been paid against each lot, from the payments saved in the Creditors / Debtors voucher store before `date`. */
export async function loadPaymentHistory(date: string): Promise<History> {
  const db = supabaseAdmin();
  const { data, error } = await fetchAllRows<{ payload: CompactVoucher }>((a, b) => db.from('outstanding_vouchers').select('payload').ilike('vch_type', 'payment%').lt('vch_date', date).order('vkey').range(a, b));
  if (error) throw error;
  const paidByLot = new Map<string, number>();
  for (const { payload } of data) for (const l of payload.lines) for (const r of l.refs) {
    if (r.drcr !== 'Dr' || /^FW\//i.test(r.ref.trim())) continue;
    const lot = lotOfRef(r.ref); if (lot) paidByLot.set(lot, Math.round(((paidByLot.get(lot) ?? 0) + r.amount) * 100) / 100);
  }
  return { paidByLot };
}

const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

/** The ERP's own records of one day: purchase receipts, Sales Register invoices and gate weighments, plus the orders still pending. */
export async function loadErpLoads(date: string): Promise<{ erpDay: ErpDay; pending: ErpPending | null }> {
  const db = supabaseAdmin(), to = nextDay(date);
  const [rc, iv, w] = await Promise.all([
    fetchAllRows<any>((a, b) => db.from('ops_purchase_receipts').select('rn_no,po_no,supplier_name,product_raw,created_at').gte('rn_date', date).lt('rn_date', to).order('created_at').range(a, b)),
    fetchAllRows<any>((a, b) => db.from('ops_sales_invoices').select('invoice_no,so_no,party_name,product_raw,created_at').gte('invoice_date', date).lt('invoice_date', to).order('created_at').range(a, b)),
    fetchAllRows<any>((a, b) => db.from('ops_weighments').select('gate_pass_no,direction,product_raw,party_name,po_no,so_no,remarks,created_at').gte('weighment_date', date).lt('weighment_date', to).order('created_at').range(a, b)),
  ]);
  for (const r of [rc, iv, w]) if (r.error) throw r.error;
  const receipts: ErpWeighment[] = []; const seenRn = new Set<string>();
  for (const r of rc.data) { const k = String(r.rn_no || '').trim(); if (k && seenRn.has(k)) continue; if (k) seenRn.add(k); receipts.push({ gate: k, direction: 'IN', product: String(r.product_raw || ''), party: String(r.supplier_name || ''), po: String(r.po_no || ''), so: '', remarks: '' }); }
  // An invoice repeats on each of its product lines: one load per invoice, its products joined.
  const byInv = new Map<string, ErpWeighment & { prods: Set<string> }>();
  for (const r of iv.data) { const k = String(r.invoice_no || '').trim(); if (!k) continue; const cur = byInv.get(k) || byInv.set(k, { gate: k, direction: 'OUT', product: '', party: String(r.party_name || ''), po: '', so: String(r.so_no || ''), remarks: '', prods: new Set() }).get(k)!; if (r.product_raw) cur.prods.add(String(r.product_raw)); }
  const invoices: ErpWeighment[] = [...byInv.values()].map(({ prods, ...x }) => ({ ...x, product: [...prods].join(', ') }));
  const weighments: ErpWeighment[] = w.data.map((r: any) => ({ gate: String(r.gate_pass_no || '').trim(), direction: String(r.direction || '').toUpperCase(), product: String(r.product_raw || ''), party: String(r.party_name || ''), po: String(r.po_no || ''), so: String(r.so_no || ''), remarks: String(r.remarks || '') }));
  let pending: ErpPending | null = null;
  try {
    const [so, po] = await Promise.all([
      fetchAllRows<any>((a, b) => db.from('ops_sales_orders').select('so_no,status,created_at').order('created_at').range(a, b)),
      fetchAllRows<any>((a, b) => db.from('ops_purchase_orders').select('po_no,pending_qty,status,created_at').order('created_at').range(a, b)),
    ]);
    if (!so.error && !po.error) {
      const latestSo = new Map<string, string>(); for (const r of so.data) latestSo.set(String(r.so_no), String(r.status || ''));
      const latestPo = new Map<string, number>(); for (const r of po.data) latestPo.set(String(r.po_no), num(r.pending_qty) ?? 0);
      pending = { salesOrders: [...latestSo.values()].filter(s => /^(open|partially)/i.test(s)).length, purchaseOrders: [...latestPo.values()].filter(q => q > 0).length };
    }
  } catch { pending = null; }
  return { erpDay: { receipts, invoices, weighments }, pending };
}
