import * as XLSX from 'xlsx';
import { text } from '@/lib/reconciliation/normalize';
import { calendarDate } from '@/lib/reconciliation/parsers';
import { money } from '../normalize';
import { colIndex, findHeaderRow, sheetRows } from './shared';

// Real header (PurchaseSummarySVMAAdmin...xlsx, sheet "Purchasesum"),
// confirmed live — 38 columns spanning three sections in one row:
// Purchase Details (Purchase Type, Po No, ReferenceNo, Inward Date, Sup
// Name, Suplocation, Sup GSTNo, Prd Name, Lotnumber, Supinvoice No/Date,
// value, IGST/SGST/CGST Amount, Gross Amount) + Credit & Debit Details
// (VoucherType, Credit/Debit No, Credit Date, QualityRebate, a SECOND
// IGST/SGST/CGST tied to the rebate, Unloading, Weighment, Lorry Freight,
// Advance, Brokerage, Other Expenses, Tds, Final Value) + Payment Details
// (a THIRD IGST/SGST/CGST, Payable Amount, Paid Amount). Confirmed by
// cross-checking real rows against the dedicated Credit_Debit Note List
// that the Credit/Debit section here matches it field-for-field, and the
// Purchase Details section matches Purchase Register LotWise — this
// table is captured as its own independent copy anyway (an explicit,
// confirmed decision), not merged into or reconciled against either.
// ReferenceNo is the natural business key (same "RN" numbering as
// Purchase Register LotWise's rn_no).

export type ParsedPurchaseSummaryRow = {
  purchaseType: string; poNo: string; referenceNo: string; inwardDate: string; supplierName: string; supplierLocation: string;
  productRaw: string; lotNo: string; supplierInvoiceNo: string; supplierInvoiceDate: string; value: number | null;
  igstAmount: number | null; sgstAmount: number | null; cgstAmount: number | null; grossAmount: number | null;
  voucherType: string; creditDebitNo: string; creditDate: string; qualityRebate: number | null;
  rebateIgst: number | null; rebateSgst: number | null; rebateCgst: number | null;
  unloading: number | null; weighment: number | null; lorryFreight: number | null; advance: number | null;
  brokerage: number | null; otherExpenses: number | null; tds: number | null; finalValue: number | null;
  paymentIgst: number | null; paymentSgst: number | null; paymentCgst: number | null;
  payableAmount: number | null; paidAmount: number | null;
};

export function parsePurchaseSummary(book: XLSX.WorkBook): ParsedPurchaseSummaryRow[] {
  let sheet = book.SheetNames.find(s => /purchasesum/i.test(s)) || book.SheetNames[0];
  let rows = sheetRows(book, sheet);
  let hi = findHeaderRow(rows, [['ReferenceNo'], ['Sup Name'], ['Credit/Debit No']]);
  if (hi < 0) for (const s of book.SheetNames) { const r = sheetRows(book, s); const h = findHeaderRow(r, [['ReferenceNo'], ['Credit/Debit No']]); if (h >= 0) { sheet = s; rows = r; hi = h; break; } }
  if (hi < 0) throw new Error('Purchase Summary: could not locate the header row (ReferenceNo / Credit/Debit No).');
  const head = rows[hi];
  // Several column labels repeat (IGST/SGST/CGST appear three times) —
  // colIndex's first-match lookup would always find the FIRST occurrence,
  // so the later two groups are read by fixed offset from the resolved
  // "value"/"QualityRebate" anchor columns instead, mirroring
  // stockSummary.ts's own offset-from-anchor approach for repeated labels.
  const anchors = {
    purchaseType: colIndex(head, ['Purchase Type']), poNo: colIndex(head, ['Po No']), ref: colIndex(head, ['ReferenceNo']),
    inwardDate: colIndex(head, ['Inward Date']), supplier: colIndex(head, ['Sup Name']), location: colIndex(head, ['Suplocation']),
    product: colIndex(head, ['Prd Name']), lot: colIndex(head, ['Lotnumber']), supInvNo: colIndex(head, ['Supinvoice No']),
    supInvDate: colIndex(head, ['Supinvoice Date']), value: colIndex(head, ['value']), gross: colIndex(head, ['Gross Amount']),
    voucherType: colIndex(head, ['VoucherType']), cdNo: colIndex(head, ['Credit/Debit No']), creditDate: colIndex(head, ['Credit Date']),
    rebate: colIndex(head, ['QualityRebate']), unloading: colIndex(head, ['Unloading']), weighment: colIndex(head, ['Weighment']),
    lorryFreight: colIndex(head, ['Lorry Freight']), advance: colIndex(head, ['Advance']), brokerage: colIndex(head, ['Brokerage']),
    otherExp: colIndex(head, ['Other Expenses']), tds: colIndex(head, ['Tds']), finalValue: colIndex(head, ['Final Value']),
    payable: colIndex(head, ['Payable Amount']), paid: colIndex(head, ['Paid Amount']),
  };
  if ([anchors.ref, anchors.value, anchors.rebate, anchors.payable].some(i => i < 0)) throw new Error('Purchase Summary: header row is missing ReferenceNo, value, QualityRebate, or Payable Amount.');
  // Purchase-side IGST/SGST/CGST sit right after "value"; rebate-side
  // IGST/SGST/CGST sit right after "QualityRebate"; the THIRD (Payment
  // Details) IGST/SGST/CGST sits right BEFORE "Payable Amount" — all three
  // confirmed by the real column order live (this third group was missed
  // in the first pass — colIndex only ever finds the first "IGST"/"SGST"/
  // "CGST" occurrence, and nothing anchored the third group off Payable
  // Amount until this fix).
  const idx = { ...anchors, igst1: anchors.value + 1, sgst1: anchors.value + 2, cgst1: anchors.value + 3, igst2: anchors.rebate + 1, sgst2: anchors.rebate + 2, cgst2: anchors.rebate + 3, igst3: anchors.payable - 3, sgst3: anchors.payable - 2, cgst3: anchors.payable - 1 };

  const out: ParsedPurchaseSummaryRow[] = [];
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r];
    const referenceNo = text(row?.[idx.ref]);
    if (!referenceNo) continue;
    out.push({
      purchaseType: text(row[idx.purchaseType]), poNo: text(row[idx.poNo]), referenceNo, inwardDate: calendarDate(row[idx.inwardDate]),
      supplierName: text(row[idx.supplier]), supplierLocation: text(row[idx.location]), productRaw: text(row[idx.product]), lotNo: text(row[idx.lot]),
      supplierInvoiceNo: text(row[idx.supInvNo]), supplierInvoiceDate: calendarDate(row[idx.supInvDate]), value: money(row[idx.value]),
      igstAmount: money(row[idx.igst1]), sgstAmount: money(row[idx.sgst1]), cgstAmount: money(row[idx.cgst1]), grossAmount: money(row[idx.gross]),
      voucherType: text(row[idx.voucherType]), creditDebitNo: text(row[idx.cdNo]), creditDate: calendarDate(row[idx.creditDate]), qualityRebate: money(row[idx.rebate]),
      rebateIgst: money(row[idx.igst2]), rebateSgst: money(row[idx.sgst2]), rebateCgst: money(row[idx.cgst2]),
      unloading: money(row[idx.unloading]), weighment: money(row[idx.weighment]), lorryFreight: money(row[idx.lorryFreight]), advance: money(row[idx.advance]),
      brokerage: money(row[idx.brokerage]), otherExpenses: money(row[idx.otherExp]), tds: money(row[idx.tds]), finalValue: money(row[idx.finalValue]),
      paymentIgst: money(row[idx.igst3]), paymentSgst: money(row[idx.sgst3]), paymentCgst: money(row[idx.cgst3]),
      payableAmount: money(row[idx.payable]), paidAmount: money(row[idx.paid]),
    });
  }
  if (!out.length) throw new Error('Purchase Summary: no data rows found under the header.');
  return out;
}
