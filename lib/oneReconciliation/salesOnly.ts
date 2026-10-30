import type { SalesInvoiceRec } from './records';
import type { LedgerIndex } from './tallyLedger';
import { NA, NOT_FOUND, pickPrimary, type AuditEntry, type MasterRow, type ReconStatus } from './master';
import { matchProduct, type ProductMasterIndex } from './productMaster';
import { salesDebtorFields } from './salesDebtors';
import { isGroupParty } from './classification';

// The reconciliation is driven by the Weighment Register, so an ERP sales invoice whose vehicle was never weighed there — a
// single-weight vehicle, or one weighed on another weighbridge (e.g. loading at Soya Foods) — gets no row and simply goes missing
// from the Sales report. This builds a display row for each such invoice so the Sales sheet is complete. These rows are NOT part of
// `rows`, the summary or the saved run: nothing in the existing reconciliation changes.

const up = (s: unknown) => String(s ?? '').trim().toUpperCase();
const r3 = (n: number) => Number(n.toFixed(3));

export async function buildSalesWithoutWeighment(args: { runId: string; rows: MasterRow[]; invoices: SalesInvoiceRec[]; ledger: LedgerIndex; productIndex: ProductMasterIndex; from: string; to: string }): Promise<MasterRow[]> {
  const { runId, rows, invoices, ledger, productIndex, from, to } = args;
  const linked = new Set<string>();
  for (const r of rows) for (const k of ['erpReference', 'erpInvoice']) for (const part of String(r.v[k] ?? '').split(/\s\+\s|[,;]\s*/)) { const n = up(part); if (n && n !== 'NOT FOUND' && n !== 'N/A') linked.add(n); }

  // A register lists one row per invoice LINE: lines of one invoice are one invoice (quantity and amounts summed, the total is repeated).
  const byNo = new Map<string, SalesInvoiceRec[]>();
  for (const r of invoices) {
    if (!r.invoiceNo || !r.date || r.date < from || r.date > to || linked.has(up(r.invoiceNo))) continue;
    (byNo.get(up(r.invoiceNo)) || byNo.set(up(r.invoiceNo), []).get(up(r.invoiceNo))!).push(r);
  }
  const effQty = (r: SalesInvoiceRec): number | null => (/^JW/i.test(r.invoiceNo) && r.qtyKg != null ? r.qtyKg / 1000 : r.qtyMt);
  const out: MasterRow[] = [];
  let seq = 0;
  for (const lines of [...byNo.values()].sort((a, b) => a[0].date.localeCompare(b[0].date) || a[0].invoiceNo.localeCompare(b[0].invoiceNo))) {
    const first = lines[0];
    const qty = lines.every(l => effQty(l) == null) ? null : r3(lines.reduce((t, l) => t + (effQty(l) ?? 0), 0));
    const inv: SalesInvoiceRec = { ...first, qtyMt: qty, qtyKg: null, amount: lines.every(l => l.amount == null) ? null : lines.reduce((t, l) => t + (l.amount ?? 0), 0), taxAmount: lines.every(l => l.taxAmount == null) ? null : lines.reduce((t, l) => t + (l.taxAmount ?? 0), 0) };
    const product = await matchProduct(inv.product, productIndex, { allowAi: false });
    const jobWork = /^JW/i.test(inv.invoiceNo);
    const booked = (ledger.byNewRef.get(up(inv.invoiceNo)) || [])[0] || null;
    const sd = salesDebtorFields(inv, ledger, product.masterProductName || inv.product || '', inv.party);
    const statuses: ReconStatus[] = ['PARTIAL MATCH'];
    if (!booked && !jobWork) statuses.unshift('TALLY MISSING');
    const primary = pickPrimary(statuses);
    const saleType = jobWork ? 'Job work' : isGroupParty(inv.party) ? 'Group company' : 'Direct sale';
    const audit: AuditEntry[] = [{ stage: 'ERP', field: 'ERP Reference', rawValue: inv.invoiceNo, normalizedValue: up(inv.invoiceNo), origin: inv.prov.origin, sourceFile: inv.prov.file, sourceSheet: inv.prov.sheet, sourceRow: String(inv.prov.row), rule: 'Sales Register invoice with no weighment row', confidence: 1, runId }];
    const note = `Sales invoice ${inv.invoiceNo} to ${inv.party}${qty != null ? ` (${qty} MT)` : ''} is in the ERP Sales Register, but no weighment row was found for vehicle ${inv.vehicle || '(none)'} on ${inv.date}: a single-weight vehicle, or one weighed on another weighbridge. ${booked ? `Tally booking ${booked.vchNo} found.` : jobWork ? 'Job-work invoices are not booked in Tally.' : 'No Tally booking was identified.'}`;
    const v: Record<string, string | number> = {
      reconId: `ONE-${inv.date.replace(/-/g, '')}-W${String(++seq).padStart(3, '0')}`, transactionType: 'Sales', date: inv.date, reconStatus: primary, exceptions: statuses.filter(s => s !== 'PARTIAL MATCH').join(', ') || NA, runId,
      gatePass: NOT_FOUND, vehicle: inv.vehicle || NOT_FOUND, party: inv.party || NOT_FOUND, material: inv.product || NOT_FOUND,
      productMaster: product.masterProductName || NOT_FOUND, productCategory: product.masterCategory || NOT_FOUND, productMethod: product.matchMethod, productConfidence: Math.round(product.matchConfidence * 100),
      supplierInvoice: NA, po: NA, so: inv.soNo || NOT_FOUND, lot: NA,
      grossWeight: NOT_FOUND, tareWeight: NOT_FOUND, netWeight: NOT_FOUND,
      erpReference: inv.invoiceNo, erpInvoice: inv.invoiceNo, erpQuantity: qty ?? NOT_FOUND, erpRate: inv.rate ?? NOT_FOUND,
      tallyVoucherNo: booked ? booked.vchNo : jobWork ? NA : NOT_FOUND, tallyVoucherDate: booked ? booked.date : jobWork ? NA : NOT_FOUND, tallyVoucherType: booked ? booked.vchType : jobWork ? NA : NOT_FOUND, tallyAmount: booked?.amount ?? (jobWork ? NA : NOT_FOUND),
      ...sd.fields,
      saleType, weighmentParty: NOT_FOUND, weighmentStatus: 'No weighment record',
      dataQuality: 'No weighment record (single-weight vehicle, or weighed on another weighbridge)', matchConfidence: 0, matchMethod: 'ERP sales invoice only', exceptionCategory: primary, aiComment: [note, ...sd.notes].join(' '),
    };
    out.push({ reconId: String(v.reconId), runId, transactionType: 'Sales', primaryStatus: primary, statuses, v, product, audit });
  }
  return out;
}
