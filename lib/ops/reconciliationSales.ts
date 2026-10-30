import { supabaseAdmin } from '@/lib/supabase/admin';
import { TOLERANCE_MT, TOLERANCE_PCT } from './reconciliation';
import { writeExceptions, type NewException } from './exceptions';

export type SalesReconciliationRow = { soNo: string; productName: string; dispatchedQty: number; invoicedQty: number; variance: number; variancePct: number | null; status: 'matched' | 'deviation' };

function exceeds(variance: number, base: number): boolean {
  const pct = base ? Math.abs(variance) / Math.abs(base) * 100 : (variance ? 100 : 0);
  return Math.abs(variance) > TOLERANCE_MT || pct > TOLERANCE_PCT;
}

/** Sale Order Details reports one ambiguous Quantity/DespatchedQty pair per
 * row alongside its own UOM column — confirmed against real data this is
 * NOT always MT: Soya Bari variants and several packed products report in
 * KGS (e.g. "5400" is 5.4 MT), some report in NOS (a bag/unit count, not
 * comparable to an MT invoice figure at all). Sales Register's own
 * quantity_mt is already unambiguous and needs no conversion. Returns null
 * for a NOS (or otherwise non-weight) row — exclude it from the MT
 * comparison entirely, same precedent as Production/Stock's packing-unit
 * handling, rather than silently comparing a bag count to an MT figure. */
function toMt(qty: number, uom: string | null | undefined): number | null {
  const u = (uom || '').trim().toUpperCase();
  if (u === 'MT' || u === '') return qty;
  if (u === 'KGS' || u === 'KG') return qty / 1000;
  return null;
}

/** Sales Register's own "Quantity MT/No's" column is likewise not always a
 * true MT figure — confirmed against every row of the real file: for a
 * bulk-sold product it holds the real MT tonnage directly, and the
 * adjacent "Quantity KG/Ltr" column mirrors that same MT-scale number
 * (not a genuine kg value). For a bag-packed product (e.g. Soya Bari) it
 * instead holds the BAG COUNT, and "Quantity KG/Ltr" holds the real total
 * weight in kilograms. The two columns disagreeing is exactly the signal
 * that distinguishes the two cases — there's no separate UOM flag here
 * the way Sale Order Details has one. */
function invoiceLineMt(quantityMt: number | null, quantityKg: number | null): number {
  const mt = quantityMt || 0, kg = quantityKg || 0;
  if (kg && Math.abs(kg - mt) > 0.001) return kg / 1000;
  return mt;
}

/** SO dispatched qty vs Sales Register invoiced qty, per SO — the two-way
 * core of the four-way compare spec section 22 describes (SO/Invoice/
 * Weighment/Stock); Gate Out + Time Office Out weighment cross-checks are
 * available via ops_weighments/ops_gate_movements for drill-down but not
 * folded into this headline number yet. Pure/read-only. */
export async function computeSalesReconciliationRows(reportDate: string): Promise<SalesReconciliationRow[]> {
  const db = supabaseAdmin();
  const [{ data: orders }, { data: invoices }] = await Promise.all([
    db.from('ops_sales_orders').select('so_no,product_raw,dispatched_qty,uom').eq('so_date', reportDate),
    db.from('ops_sales_invoices').select('so_no,product_raw,quantity_mt,quantity_kg').eq('invoice_date', reportDate),
  ]);
  const bySo = new Map<string, { productName: string; dispatchedQty: number }>();
  for (const r of orders || []) {
    const dispatchedQty = toMt(Number((r as any).dispatched_qty || 0), (r as any).uom);
    if (dispatchedQty === null) continue; // NOS/count row — not MT-comparable
    const key = `${(r as any).so_no}|${(r as any).product_raw}`; bySo.set(key, { productName: (r as any).product_raw, dispatchedQty });
  }
  const invoicedBySo = new Map<string, number>();
  for (const r of invoices || []) { if (!(r as any).so_no) continue; const key = `${(r as any).so_no}|${(r as any).product_raw}`; invoicedBySo.set(key, (invoicedBySo.get(key) || 0) + invoiceLineMt((r as any).quantity_mt, (r as any).quantity_kg)); }

  const rows: SalesReconciliationRow[] = [];
  const allKeys = new Set([...bySo.keys(), ...invoicedBySo.keys()]);
  for (const key of allKeys) {
    const [soNo] = key.split('|');
    const order = bySo.get(key);
    const dispatchedQty = order?.dispatchedQty || 0;
    const invoicedQty = invoicedBySo.get(key) || 0;
    if (!order && !invoicedQty) continue;
    const variance = invoicedQty - dispatchedQty;
    const variancePct = dispatchedQty ? (variance / dispatchedQty) * 100 : null;
    rows.push({ soNo, productName: order?.productName || key.split('|')[1], dispatchedQty, invoicedQty, variance, variancePct, status: exceeds(variance, dispatchedQty) ? 'deviation' : 'matched' });
  }
  return rows.sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));
}

export async function reconcileSales(reportDate: string): Promise<{ rows: SalesReconciliationRow[]; exceptionsCreated: number; ticketsCreated: number }> {
  const rows = await computeSalesReconciliationRows(reportDate);
  const exceptions: NewException[] = rows.filter(r => r.status === 'deviation').map(r => ({
    exceptionType: 'sales_dispatch_invoice_variance', severity: Math.abs(r.variance) > TOLERANCE_MT * 4 ? 'critical' : 'warning',
    reportDate, module: 'ops_sales', referenceIds: { soNo: r.soNo, product: r.productName },
    expectedValue: r.dispatchedQty, actualValue: r.invoicedQty, variance: r.variance, variancePct: r.variancePct, toleranceUsed: TOLERANCE_MT,
    description: `SO ${r.soNo} (${r.productName}): dispatched ${r.dispatchedQty.toFixed(3)} MT vs invoiced ${r.invoicedQty.toFixed(3)} MT on ${reportDate} — a ${r.variance.toFixed(3)} MT variance.`,
  }));
  const { created, ticketsCreated } = await writeExceptions(exceptions);
  return { rows, exceptionsCreated: created, ticketsCreated };
}
