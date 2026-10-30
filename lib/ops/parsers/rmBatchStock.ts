import * as XLSX from 'xlsx';
import { text } from '@/lib/reconciliation/normalize';
import { calendarDate } from '@/lib/reconciliation/parsers';
import { money } from '../normalize';
import { colIndex, findHeaderRow, sheetRows } from './shared';

// Real header (RawMaterialBatchWiseStock.xlsx, sheet "RMBatchwiseStock"):
// LotNo | Date | Grade | SupplierName | Weight | Area | Jute | Plastic |
// Total Bags | Rate | Value

export type ParsedRmBatchRow = {
  lotNo: string; reportDate: string; grade: string; supplierName: string; weightMt: number | null;
  area: string; juteBag: number | null; plasticBag: number | null; totalBags: number | null;
  rate: number | null; value: number | null;
};

export function parseRmBatchStock(book: XLSX.WorkBook): { asOfDate: string; rows: ParsedRmBatchRow[] } {
  let sheet = book.SheetNames.find(s => /rmbatch|batchwise/i.test(s)) || book.SheetNames[0];
  let rows = sheetRows(book, sheet);
  let hi = findHeaderRow(rows, [['LotNo', 'Lot No'], ['Weight'], ['SupplierName', 'Supplier Name']]);
  if (hi < 0) for (const s of book.SheetNames) { const r = sheetRows(book, s); const h = findHeaderRow(r, [['LotNo', 'Lot No'], ['Weight']]); if (h >= 0) { sheet = s; rows = r; hi = h; break; } }
  if (hi < 0) throw new Error('RawMaterialBatchWiseStock: could not locate the header row (LotNo / Weight).');
  const head = rows[hi];
  const idx = {
    lot: colIndex(head, ['LotNo', 'Lot No']), date: colIndex(head, ['Date']), grade: colIndex(head, ['Grade']),
    supplier: colIndex(head, ['SupplierName', 'Supplier Name']), weight: colIndex(head, ['Weight']), area: colIndex(head, ['Area']),
    jute: colIndex(head, ['Jute']), plastic: colIndex(head, ['Plastic']), totalBags: colIndex(head, ['Total Bags', "Total Bag's"]),
    rate: colIndex(head, ['Rate']), value: colIndex(head, ['Value']),
  };
  // The "As OnDate" title text (row 0-3 letterhead block) gives the snapshot's
  // own as-of date, distinct from each lot's own receipt "Date" column.
  const titleCell = text(rows.slice(0, 5).flat().find(c => /as\s*on\s*date/i.test(text(c))));
  const asOfMatch = titleCell.match(/(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})/);
  const asOfDate = asOfMatch ? calendarDate(asOfMatch[1]) : '';
  const out: ParsedRmBatchRow[] = [];
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r];
    const lotNo = text(row?.[idx.lot]);
    if (!lotNo) continue;
    out.push({
      lotNo, reportDate: calendarDate(row[idx.date]), grade: text(row[idx.grade]), supplierName: text(row[idx.supplier]),
      weightMt: money(row[idx.weight]), area: text(row[idx.area]), juteBag: money(row[idx.jute]), plasticBag: money(row[idx.plastic]),
      totalBags: money(row[idx.totalBags]), rate: money(row[idx.rate]), value: money(row[idx.value]),
    });
  }
  if (!out.length) throw new Error('RawMaterialBatchWiseStock: no data rows found under the header.');
  if (!asOfDate) throw new Error('RawMaterialBatchWiseStock: could not detect the "As On Date" snapshot date from the report title.');
  return { asOfDate, rows: out };
}
