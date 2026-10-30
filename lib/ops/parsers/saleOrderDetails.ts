import * as XLSX from 'xlsx';
import { text } from '@/lib/reconciliation/normalize';
import { calendarDate } from '@/lib/reconciliation/parsers';
import { money } from '../normalize';
import { colIndex, findHeaderRow, sheetRows } from './shared';

// Real header (Sale Order Details.xlsx, sheet "SaleOrderDetails"):
// Date | SaleOrder No. | CustomerPoNo | PO Date | CustomerName |
// CustomerLocation | ConsigneeName | DispatchLocation | ProductName |
// PackingSize | Freight Terms | ... | Quantity | UOM | Rate (KgLtr) |
// DespatchedQty | Status | GrossAmount | ... | Total Amount | Type

export type ParsedSaleOrderRow = {
  soNo: string; soDate: string; customerPoNo: string; customerName: string; customerLocation: string; consigneeName: string; dispatchLocation: string;
  productRaw: string; packingSize: string; quantity: number | null; uom: string; rate: number | null; despatchedQty: number | null; status: string;
  grossAmount: number | null; totalAmount: number | null;
};

export function parseSaleOrderDetails(book: XLSX.WorkBook): ParsedSaleOrderRow[] {
  let sheet = book.SheetNames.find(s => /saleorderdetails/i.test(s)) || book.SheetNames[0];
  let rows = sheetRows(book, sheet);
  let hi = findHeaderRow(rows, [['SaleOrder No.', 'SaleOrder No'], ['CustomerName'], ['DespatchedQty']]);
  if (hi < 0) for (const s of book.SheetNames) { const r = sheetRows(book, s); const h = findHeaderRow(r, [['SaleOrder No.', 'SaleOrder No'], ['DespatchedQty']]); if (h >= 0) { sheet = s; rows = r; hi = h; break; } }
  if (hi < 0) throw new Error('Sale Order Details: could not locate the header row (SaleOrder No. / DespatchedQty).');
  const head = rows[hi];
  const idx = {
    date: colIndex(head, ['Date']), so: colIndex(head, ['SaleOrder No.', 'SaleOrder No']), custPo: colIndex(head, ['CustomerPoNo']),
    customer: colIndex(head, ['CustomerName']), location: colIndex(head, ['CustomerLocation']), consignee: colIndex(head, ['ConsigneeName']), dispatchLoc: colIndex(head, ['DispatchLocation']),
    product: colIndex(head, ['ProductName']), packing: colIndex(head, ['Packing\nSize', 'PackingSize']), qty: colIndex(head, ['Quantity']), uom: colIndex(head, ['UOM']),
    rate: colIndex(head, ['Rate\n (KgLtr)', 'Rate (KgLtr)']), despatched: colIndex(head, ['DespatchedQty']), status: colIndex(head, ['Status']),
    gross: colIndex(head, ['GrossAmount']), total: colIndex(head, ['Total\nAmount', 'Total Amount']),
  };
  const out: ParsedSaleOrderRow[] = [];
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r];
    const soNo = text(row?.[idx.so]);
    if (!soNo) continue;
    out.push({
      soNo, soDate: calendarDate(row[idx.date]), customerPoNo: text(row[idx.custPo]), customerName: text(row[idx.customer]), customerLocation: text(row[idx.location]),
      consigneeName: text(row[idx.consignee]), dispatchLocation: text(row[idx.dispatchLoc]), productRaw: text(row[idx.product]), packingSize: text(row[idx.packing]),
      quantity: money(row[idx.qty]), uom: text(row[idx.uom]), rate: money(row[idx.rate]), despatchedQty: money(row[idx.despatched]), status: text(row[idx.status]),
      grossAmount: money(row[idx.gross]), totalAmount: money(row[idx.total]),
    });
  }
  if (!out.length) throw new Error('Sale Order Details: no data rows found under the header.');
  return out;
}
