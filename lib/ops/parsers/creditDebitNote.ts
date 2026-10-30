import * as XLSX from 'xlsx';
import { text } from '@/lib/reconciliation/normalize';
import { calendarDate } from '@/lib/reconciliation/parsers';
import { money } from '../normalize';
import { colIndex, findHeaderRow, sheetRows } from './shared';

// Real header (Credit_Debit Note ListSVMAAdmin...xlsx, sheet "CreditList"),
// confirmed live: PONo | Date | PurchaseType | Invoice No | LotNumber |
// Reference Number | Customer Name | Product Name | NetWeight |
// FinalWeight | LabOil | RepOil | Rate Type | BillRate | FinalRate |
// JuteBag | PackRate | PackCost | Value | SGST | CGST | IGST | TOTAL GST |
// Weightment | Unloading | LorryFreight | Advance | Brokerage |
// OtherExpenses | TDS | NetValue | BillValue | Rebate Value | Rebate
// IGST/CGST/SGST Amount | Rebate TOTAL GST | Rebate Net Value. PONo is
// blank on every row after the first of a PO group (carry-forward, same
// shape as inwardPayment.ts). Each PO group ends in a SUBTOTAL row —
// confirmed live: blank Invoice No / LotNumber / Reference Number /
// Customer Name, but aggregate Value/GST/etc columns populated — excluded
// by requiring Reference Number present, same filter the existing
// Finance-side parseCreditDebit() in lib/reconcile.ts already uses (that
// function is untouched by this file; this is an independent, separate
// Operations copy of the same source report, per explicit instruction).
// Reference Number is the natural business key (each note's own "DN"/"CN"
// identity, confirmed unique across every real row — never a re-used
// receipt/invoice number).

export type ParsedCreditDebitNoteRow = {
  poNo: string; date: string; purchaseType: string; invoiceNo: string; lotNo: string; referenceNumber: string;
  customerName: string; productRaw: string; netWeight: number | null; finalWeight: number | null; labOil: number | null; repOil: number | null;
  rateType: string; billRate: number | null; finalRate: number | null; juteBag: number | null; packRate: number | null; packCost: number | null;
  value: number | null; sgst: number | null; cgst: number | null; igst: number | null; totalGst: number | null;
  weightment: number | null; unloading: number | null; lorryFreight: number | null; advance: number | null; brokerage: number | null;
  otherExpenses: number | null; tds: number | null; netValue: number | null; billValue: number | null;
  rebateValue: number | null; rebateIgst: number | null; rebateCgst: number | null; rebateSgst: number | null; rebateTotalGst: number | null; rebateNetValue: number | null;
};

export function parseCreditDebitNote(book: XLSX.WorkBook): ParsedCreditDebitNoteRow[] {
  let sheet = book.SheetNames.find(s => /creditlist/i.test(s)) || book.SheetNames[0];
  let rows = sheetRows(book, sheet);
  let hi = findHeaderRow(rows, [['PONo'], ['Invoice No'], ['Reference Number']]);
  if (hi < 0) for (const s of book.SheetNames) { const r = sheetRows(book, s); const h = findHeaderRow(r, [['PONo'], ['Reference Number']]); if (h >= 0) { sheet = s; rows = r; hi = h; break; } }
  if (hi < 0) throw new Error('Credit / Debit Note: could not locate the header row (PONo / Reference Number).');
  const head = rows[hi];
  const idx = {
    poNo: colIndex(head, ['PONo']), date: colIndex(head, ['Date']), purchaseType: colIndex(head, ['PurchaseType']),
    invoiceNo: colIndex(head, ['Invoice No']), lotNo: colIndex(head, ['LotNumber']), refNo: colIndex(head, ['Reference Number']),
    customer: colIndex(head, ['Customer Name']), product: colIndex(head, ['Product Name']),
    netWeight: colIndex(head, ['NetWeight']), finalWeight: colIndex(head, ['FinalWeight']), labOil: colIndex(head, ['LabOil']), repOil: colIndex(head, ['RepOil']),
    rateType: colIndex(head, ['Rate Type']), billRate: colIndex(head, ['BillRate']), finalRate: colIndex(head, ['FinalRate']),
    juteBag: colIndex(head, ['JuteBag']), packRate: colIndex(head, ['PackRate']), packCost: colIndex(head, ['PackCost']),
    value: colIndex(head, ['Value']), sgst: colIndex(head, ['SGST']), cgst: colIndex(head, ['CGST']), igst: colIndex(head, ['IGST']), totalGst: colIndex(head, ['TOTAL GST']),
    weightment: colIndex(head, ['Weightment']), unloading: colIndex(head, ['Unloading']), lorryFreight: colIndex(head, ['LorryFreight']),
    advance: colIndex(head, ['Advance']), brokerage: colIndex(head, ['Brokerage']), otherExp: colIndex(head, ['OtherExpenses']), tds: colIndex(head, ['TDS']),
    netValue: colIndex(head, ['NetValue']), billValue: colIndex(head, ['BillValue']),
    rebateValue: colIndex(head, ['Rebate Value']), rebateIgst: colIndex(head, ['Rebate IGST Amount']), rebateCgst: colIndex(head, ['Rebate CGST Amount']),
    rebateSgst: colIndex(head, ['Rebate SGST Amount']), rebateTotalGst: colIndex(head, ['Rebate TOTAL GST']), rebateNetValue: colIndex(head, ['Rebate Net Value']),
  };
  if ([idx.refNo, idx.lotNo, idx.invoiceNo].some(i => i < 0)) throw new Error('Credit / Debit Note: header row is missing Reference Number, LotNumber, or Invoice No.');

  const out: ParsedCreditDebitNoteRow[] = [];
  let poNo = '';
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r];
    const rowPoNo = text(row?.[idx.poNo]);
    if (rowPoNo) poNo = rowPoNo;
    const referenceNumber = text(row?.[idx.refNo]);
    if (!referenceNumber || !text(row?.[idx.lotNo])) continue; // blank on the per-PO subtotal row
    out.push({
      poNo, date: calendarDate(row[idx.date]), purchaseType: text(row[idx.purchaseType]), invoiceNo: text(row[idx.invoiceNo]), lotNo: text(row[idx.lotNo]), referenceNumber,
      customerName: text(row[idx.customer]), productRaw: text(row[idx.product]), netWeight: money(row[idx.netWeight]), finalWeight: money(row[idx.finalWeight]),
      labOil: money(row[idx.labOil]), repOil: money(row[idx.repOil]), rateType: text(row[idx.rateType]), billRate: money(row[idx.billRate]), finalRate: money(row[idx.finalRate]),
      juteBag: money(row[idx.juteBag]), packRate: money(row[idx.packRate]), packCost: money(row[idx.packCost]),
      value: money(row[idx.value]), sgst: money(row[idx.sgst]), cgst: money(row[idx.cgst]), igst: money(row[idx.igst]), totalGst: money(row[idx.totalGst]),
      weightment: money(row[idx.weightment]), unloading: money(row[idx.unloading]), lorryFreight: money(row[idx.lorryFreight]),
      advance: money(row[idx.advance]), brokerage: money(row[idx.brokerage]), otherExpenses: money(row[idx.otherExp]), tds: money(row[idx.tds]),
      netValue: money(row[idx.netValue]), billValue: money(row[idx.billValue]),
      rebateValue: money(row[idx.rebateValue]), rebateIgst: money(row[idx.rebateIgst]), rebateCgst: money(row[idx.rebateCgst]),
      rebateSgst: money(row[idx.rebateSgst]), rebateTotalGst: money(row[idx.rebateTotalGst]), rebateNetValue: money(row[idx.rebateNetValue]),
    });
  }
  if (!out.length) throw new Error('Credit / Debit Note: no data rows found under the header.');
  return out;
}
