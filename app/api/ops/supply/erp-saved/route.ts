import { moduleAuthorization, OPS_ROLES } from '@/lib/authorize';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { fetchAllRows } from '@/lib/supabase/fetchAll';
import { errorMessage, logServerError } from '@/lib/errors';

export const runtime = 'nodejs';
const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** The consolidated ERP API data saved by the daily sync, plus when it last ran. */
export async function GET(req: NextRequest) {
  try {
    const az = await moduleAuthorization('operations_intelligence', OPS_ROLES);
    if (!az.ok) return NextResponse.json({ error: az.status === 401 ? 'Not authenticated' : 'Operations Intelligence access not assigned' }, { status: az.status });
    const db = supabaseAdmin(), q = req.nextUrl.searchParams, report = q.get('report') || '';
    const { data: lastRun, error: runErr } = await db.from('erp_api_sync_runs').select('id,started_at,finished_at,trigger,status,details,error').order('started_at', { ascending: false }).limit(1).maybeSingle();
    if (runErr) return NextResponse.json({ error: 'The saved ERP data is not set up yet — run sql/073_erp_api_sync.sql in Supabase.', code: 'not_set_up' }, { status: 503 });
    const base = { lastRun };
    if (report === 'status') {
      const { data: snaps } = await fetchAllRows<{ snapshot_date: string; balance_qty: number }>((a, b) => db.from('erp_api_pending_contracts').select('snapshot_date,balance_qty').order('snapshot_date', { ascending: false }).range(a, b));
      const by = new Map<string, { date: string; contracts: number; balance: number }>();
      for (const r of snaps) { const x = by.get(r.snapshot_date) || { date: r.snapshot_date, contracts: 0, balance: 0 }; x.contracts++; x.balance += Number(r.balance_qty) || 0; by.set(r.snapshot_date, x); }
      return NextResponse.json({ ...base, snapshots: [...by.values()].slice(0, 90) });
    }
    if (report === 'pending') {
      let snap = q.get('snapshot');
      if (!isDate(snap)) { const { data } = await db.from('erp_api_pending_contracts').select('snapshot_date').order('snapshot_date', { ascending: false }).limit(1).maybeSingle(); snap = data?.snapshot_date || null; }
      if (!snap) return NextResponse.json({ ...base, report, rows: [] });
      const { data, error } = await fetchAllRows<any>((a, b) => db.from('erp_api_pending_contracts').select('*').eq('snapshot_date', snap).order('contract_no').range(a, b));
      if (error) throw error;
      return NextResponse.json({ ...base, report, snapshot: snap, rows: data.map(r => ({ contractNo: r.contract_no, contractDate: r.contract_date, partyName: r.party_name, productName: r.product_name, brokerName: r.broker_name, contractQty: Number(r.contract_qty), receivedQty: Number(r.received_qty), balanceQty: Number(r.balance_qty), rate: Number(r.rate) })) });
    }
    const from = q.get('from'), to = q.get('to');
    if (!isDate(from) || !isDate(to)) return NextResponse.json({ error: 'Choose the From and To dates.' }, { status: 400 });
    if (report === 'payments') {
      const { data, error } = await fetchAllRows<any>((a, b) => db.from('erp_api_payments').select('*').gte('payment_date', from).lte('payment_date', to).order('payment_date').order('row_key').range(a, b));
      if (error) throw error;
      return NextResponse.json({ ...base, report, rows: data.map(r => ({ paymentReferenceNo: r.payment_ref, paymentDate: r.payment_date, bankName: r.bank_name, supplierName: r.supplier_name, supplierLocationName: r.supplier_location, lotNumber: r.lot_number, amount: Number(r.amount), totalAmount: Number(r.total_amount), supplierId: r.supplier_id })) });
    }
    if (report === 'purchases') {
      const { data, error } = await fetchAllRows<any>((a, b) => db.from('erp_api_purchase_docs').select('*').gte('po_date', from).lte('po_date', to).order('po_date').order('row_key').range(a, b));
      if (error) throw error;
      return NextResponse.json({ ...base, report, rows: data.map(r => ({ title: r.title, poNumber: r.po_number, poDate: r.po_date, supplierName: r.supplier_name, materialName: r.material_name, orderedQty: Number(r.ordered_qty), quantityKG: Number(r.quantity_kg), rate: Number(r.rate), taxableAmt: Number(r.taxable_amt), taxAmount: Number(r.tax_amount), totalAmount: Number(r.total_amount), locationName: r.location_name, status: r.status })) });
    }
    return NextResponse.json({ error: 'Choose a report: pending, payments or purchases.' }, { status: 400 });
  } catch (e) {
    logServerError('ops/supply/erp-saved', e);
    return NextResponse.json({ error: errorMessage(e, 'Unable to read the saved ERP data.') }, { status: 500 });
  }
}
