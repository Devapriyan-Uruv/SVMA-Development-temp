import * as XLSX from 'xlsx';
import { text } from '@/lib/reconciliation/normalize';
import { calendarDate } from '@/lib/reconciliation/parsers';
import { money } from '../normalize';
import { colIndex, findHeaderRow, sheetRows } from './shared';

// Real header (Purchase Details.xlsx, sheet "PurchaseOrderSVMA"):
// S.No | PO Number | PO Date | Supplier Name | Material Name | Order Qty |
// Rate | Taxable Amt | Tax Amt | Total Amt | Received Qty | Pen.Qty | Status

export type ParsedPurchaseDetailRow = {
  poNo: string; poDate: string; supplierName: string; productRaw: string;
  orderedQty: number | null; rate: number | null; receivedQty: number | null; pendingQty: number | null; status: string;
};

export function parsePurchaseDetails(book: XLSX.WorkBook): ParsedPurchaseDetailRow[] {
  let sheet = book.SheetNames.find(s => /purchaseorder/i.test(s)) || book.SheetNames[0];
  let rows = sheetRows(book, sheet);
  let hi = findHeaderRow(rows, [['PO Number'], ['Supplier Name'], ['Order Qty']]);
  if (hi < 0) for (const s of book.SheetNames) { const r = sheetRows(book, s); const h = findHeaderRow(r, [['PO Number'], ['Order Qty']]); if (h >= 0) { sheet = s; rows = r; hi = h; break; } }
  if (hi < 0) throw new Error('Purchase Details: could not locate the header row (PO Number / Order Qty).');
  const head = rows[hi];
  const idx = {
    po: colIndex(head, ['PO Number']), date: colIndex(head, ['PO Date']), supplier: colIndex(head, ['Supplier Name']), product: colIndex(head, ['Material Name']),
    ordered: colIndex(head, ['Order Qty']), rate: colIndex(head, ['Rate']), received: colIndex(head, ['Received Qty']), pending: colIndex(head, ['Pen.Qty']), status: colIndex(head, ['Status']),
  };
  const out: ParsedPurchaseDetailRow[] = [];
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r];
    const poNo = text(row?.[idx.po]);
    if (!poNo) continue;
    out.push({
      poNo, poDate: calendarDate(row[idx.date]), supplierName: text(row[idx.supplier]), productRaw: text(row[idx.product]),
      orderedQty: money(row[idx.ordered]), rate: money(row[idx.rate]), receivedQty: money(row[idx.received]), pendingQty: money(row[idx.pending]), status: text(row[idx.status]),
    });
  }
  if (!out.length) throw new Error('Purchase Details: no data rows found under the header.');
  return out;
}
