import type { SalesInvoiceRec } from './records';
import type { LedgerIndex, TallyLedgerVoucher, TallyRef } from './tallyLedger';
import { splitGst } from './gst';

// Fields for the SALES (debtors) sheet. Additive only: nothing here feeds a
// status or any existing reconciliation rule.
//
// Receipts: customer receipts are the credit "Agst Ref" lines (on Receipt
// vouchers) whose reference is the ERP invoice number — the mirror of supplier
// payments, which are the debit Agst Ref lines. Tally's own booking amount equals
// the ERP invoice total, so the ERP total is the base.
//
// Quality cut: invoice total minus everything credited to the invoice in Tally,
// but only when at least one receipt exists and the gap is small
// (<= QUALITY_CUT_MAX_PCT of the invoice). A bigger gap is a balance still
// outstanding (partial payment), not a cut.

export const QUALITY_CUT_MAX_PCT = 2;
const TOLERANCE = 1;

export const SALES_FIELD_KEYS = [
  'salesMaterial', 'salesInvoiceParty', 'salesPlace', 'salesAssValue', 'salesIgst', 'salesCgst', 'salesSgst', 'salesInvoiceTotal',
  'receipt1Date', 'receipt1Amount', 'receipt2Date', 'receipt2Amount', 'receipt3Date', 'receipt3Amount',
  'qualityCutAmount', 'qualityCutRef', 'qualityCutTotal', 'balanceBeforeCut', 'balanceAfterCut',
] as const;

export type SalesCredit = { voucher: TallyLedgerVoucher; ref: TallyRef };
const money = (n: number) => `₹${Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const r2 = (n: number) => Number(n.toFixed(2));

export function salesDebtorFields(invoice: SalesInvoiceRec | null, ledger: LedgerIndex, materialName: string, weighmentParty = ''): { fields: Record<string, string | number>; notes: string[]; receipts: SalesCredit[] } {
  // PARTY NAME is the party on the ERP invoice (the weighbridge name is often a short or wrong name); the weighment's own name only when there is no invoice.
  const f: Record<string, string | number> = { salesMaterial: materialName || 'Not Found', salesInvoiceParty: invoice?.party || weighmentParty || 'Not Found', salesPlace: invoice?.place || (invoice ? 'Not Found' : 'Not Found') };
  const blank = ['receipt1Date', 'receipt1Amount', 'receipt2Date', 'receipt2Amount', 'receipt3Date', 'receipt3Amount', 'qualityCutAmount', 'qualityCutRef', 'qualityCutTotal', 'balanceBeforeCut', 'balanceAfterCut'];
  const notes: string[] = [];
  if (!invoice) {
    for (const k of ['salesAssValue', 'salesIgst', 'salesCgst', 'salesSgst', 'salesInvoiceTotal']) f[k] = 'Not Found';
    for (const k of blank) f[k] = '';
    return { fields: f, notes, receipts: [] };
  }

  const gst = splitGst(invoice.taxAmount, invoice.place);
  f.salesAssValue = invoice.amount ?? 'Not Found';
  f.salesIgst = gst ? gst.igst : 'Not Found'; f.salesCgst = gst ? gst.cgst : 'Not Found'; f.salesSgst = gst ? gst.sgst : 'Not Found';
  f.salesInvoiceTotal = invoice.totalInvoiceAmount ?? 'Not Found';

  // One weighment can carry several invoices: their credits are taken together against the invoices' total.
  const keys = (invoice.parts || [invoice]).map(p => p.invoiceNo.toUpperCase().replace(/\s+/g, ''));
  const credits = keys.flatMap(k => (ledger.creditsByRef.get(k) || []) as SalesCredit[]);
  const isReceipt = (c: SalesCredit) => /receipt/i.test(c.voucher.vchType);
  const receipts = credits.filter(isReceipt).sort((a, b) => a.voucher.date.localeCompare(b.voucher.date) || a.voucher.vchNo.localeCompare(b.voucher.vchNo));
  for (const k of blank) f[k] = '';
  const slot = (i: number, list: SalesCredit[]) => {
    if (!list.length) return;
    f[`receipt${i}Date`] = list[list.length - 1].voucher.date;
    f[`receipt${i}Amount`] = r2(list.reduce((s, c) => s + (c.ref.amount ?? 0), 0));
  };
  slot(1, receipts.slice(0, 1)); slot(2, receipts.slice(1, 2));
  // The format has three receipt slots; any further receipts are totalled into the third.
  slot(3, receipts.slice(2));
  if (receipts.length > 3) notes.push(`${receipts.length} receipts were found; the 3rd receipt column totals receipts 3 to ${receipts.length}.`);

  const total = invoice.totalInvoiceAmount;
  const settled = credits.reduce((s, c) => s + (c.ref.amount ?? 0), 0);
  if (total != null && credits.length) {
    const diff = r2(total - settled), pct = total ? Math.abs(diff) / total * 100 : 0;
    notes.push(`Tally shows ${credits.length} credit${credits.length === 1 ? '' : 's'} against invoice ${invoice.invoiceNo} totalling ${money(settled)} of ${money(total)}.`);
    // Balance before the quality cut = what is still unpaid on the invoice; after the cut, a short receipt within the cut limit is closed.
    f.balanceBeforeCut = diff > TOLERANCE ? diff : 0; f.balanceAfterCut = diff > TOLERANCE ? diff : 0;
    if (diff > TOLERANCE) {
      if (receipts.length && pct <= QUALITY_CUT_MAX_PCT) {
        f.qualityCutAmount = diff; f.qualityCutTotal = diff; f.balanceAfterCut = 0;
        f.qualityCutRef = [...new Set(receipts.map(c => `Receipt ${c.voucher.vchNo}`))].join(', ');
        notes.push(`Short receipt of ${money(diff)} (${pct.toFixed(2)}% of the invoice) is shown as the quality cut.`);
      } else notes.push(`Balance outstanding ${money(diff)} (${pct.toFixed(1)}% of the invoice) — treated as unpaid, not as a quality cut.`);
    } else if (diff < -TOLERANCE) notes.push(`Tally credits exceed the invoice by ${money(-diff)}.`);
  } else if (!credits.length && ledger.byKey.size) {
    if (total != null) { f.balanceBeforeCut = r2(total); f.balanceAfterCut = r2(total); }
    notes.push(`No customer receipt for invoice ${invoice.invoiceNo} was found in the Tally Day Book uploaded.`); }
  return { fields: f, notes, receipts };
}
