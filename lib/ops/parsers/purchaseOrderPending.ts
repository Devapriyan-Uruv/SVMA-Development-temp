import * as XLSX from 'xlsx';
import { text } from '@/lib/reconciliation/normalize';
import { calendarDate } from '@/lib/reconciliation/parsers';
import { money } from '../normalize';
import { colIndex, findHeaderRow, sheetRows } from './shared';

// Real header (PurchaseOrder Pending.xlsx, sheet "Popendingbills"):
// CONT NO | CONDATE | PRODUCT NAME | PARTY NAME | BROKER NAME | CONQTY | RECDQTY | BALANCEQTY | RATE
// A "TOTAL" trailer row after each product group is skipped (its CONT NO is blank).

export type ParsedPoPendingRow = {
  poNo: string; poDate: string; productRaw: string; supplierName: string; brokerName: string;
  orderedQty: number | null; receivedQty: number | null; pendingQty: number | null; rate: number | null;
};

export function parsePurchaseOrderPending(book: XLSX.WorkBook): { asOfDate: string; rows: ParsedPoPendingRow[] } {
  let sheet = book.SheetNames.find(s => /popending/i.test(s)) || book.SheetNames[0];
  let rows = sheetRows(book, sheet);
  let hi = findHeaderRow(rows, [['CONT NO'], ['PARTY NAME'], ['CONQTY']]);
  if (hi < 0) for (const s of book.SheetNames) { const r = sheetRows(book, s); const h = findHeaderRow(r, [['CONT NO'], ['CONQTY']]); if (h >= 0) { sheet = s; rows = r; hi = h; break; } }
  if (hi < 0) throw new Error('PurchaseOrder Pending: could not locate the header row (CONT NO / CONQTY).');
  const head = rows[hi];
  const idx = {
    po: colIndex(head, ['CONT NO']), date: colIndex(head, ['CONDATE']), product: colIndex(head, ['PRODUCT NAME']),
    supplier: colIndex(head, ['PARTY NAME']), broker: colIndex(head, ['BROKER NAME']),
    ordered: colIndex(head, ['CONQTY']), received: colIndex(head, ['RECDQTY']), pending: colIndex(head, ['BALANCEQTY']), rate: colIndex(head, ['RATE']),
  };
  const titleText = text(rows.slice(0, 8).flat().find(c => /as\s*on\s*date/i.test(text(c))));
  const asOfMatch = titleText.match(/(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})/);
  const asOfDate = asOfMatch ? calendarDate(asOfMatch[1]) : '';

  const out: ParsedPoPendingRow[] = [];
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r];
    const poNo = text(row?.[idx.po]);
    if (!poNo || /^total$/i.test(poNo)) continue;
    out.push({
      poNo, poDate: calendarDate(row[idx.date]), productRaw: text(row[idx.product]), supplierName: text(row[idx.supplier]), brokerName: text(row[idx.broker]),
      orderedQty: money(row[idx.ordered]), receivedQty: money(row[idx.received]), pendingQty: money(row[idx.pending]), rate: money(row[idx.rate]),
    });
  }
  if (!out.length) throw new Error('PurchaseOrder Pending: no data rows found under the header.');
  return { asOfDate, rows: out };
}
