import * as XLSX from 'xlsx';
import { text } from '@/lib/reconciliation/normalize';
import { calendarDate } from '@/lib/reconciliation/parsers';
import { colIndex, findHeaderRow, sheetRows } from './shared';

// Real header (Gate Out Entry.xlsx, sheet "GateOutEntry"):
// GatePass No | Date | Supplier Order No | Invoice Number | Invoice Date |
// Customer Name | Customer Address | Customer Location | Products Name | Vehicle No | In Time | out Time | Remarks
// "Supplier Order No" here is actually the Sale Order No (outward gate pass references the SO).

export type ParsedGateOutRow = {
  gatePassNo: string; movementDate: string; soNo: string; customerName: string; customerAddress: string; customerLocation: string;
  productRaw: string; vehicleNo: string; inTime: string; outTime: string; remarks: string;
};

export function parseGateOut(book: XLSX.WorkBook): ParsedGateOutRow[] {
  let sheet = book.SheetNames.find(s => /gateoutentry/i.test(s)) || book.SheetNames[0];
  let rows = sheetRows(book, sheet);
  let hi = findHeaderRow(rows, [['GatePass No'], ['Customer Name'], ['Vehicle No']]);
  if (hi < 0) for (const s of book.SheetNames) { const r = sheetRows(book, s); const h = findHeaderRow(r, [['GatePass No'], ['Vehicle No']]); if (h >= 0) { sheet = s; rows = r; hi = h; break; } }
  if (hi < 0) throw new Error('Gate Out Entry: could not locate the header row (GatePass No / Vehicle No).');
  const head = rows[hi];
  const idx = {
    gp: colIndex(head, ['GatePass No']), date: colIndex(head, ['Date']), so: colIndex(head, ['Supplier Order No']),
    customer: colIndex(head, ['Customer Name']), address: colIndex(head, ['Customer Address']), location: colIndex(head, ['Customer Location']),
    product: colIndex(head, ['Products Name', 'Product Name']), vehicle: colIndex(head, ['Vehicle No']),
    inTime: colIndex(head, ['In Time']), outTime: colIndex(head, ['out Time', 'Out Time']), remarks: colIndex(head, ['Remarks']),
  };
  const out: ParsedGateOutRow[] = [];
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r];
    const gatePassNo = text(row?.[idx.gp]);
    if (!gatePassNo) continue;
    out.push({
      gatePassNo, movementDate: calendarDate(row[idx.date]), soNo: text(row[idx.so]), customerName: text(row[idx.customer]), customerAddress: text(row[idx.address]),
      customerLocation: text(row[idx.location]), productRaw: text(row[idx.product]), vehicleNo: text(row[idx.vehicle]), inTime: text(row[idx.inTime]), outTime: text(row[idx.outTime]), remarks: text(row[idx.remarks]),
    });
  }
  if (!out.length) throw new Error('Gate Out Entry: no data rows found under the header.');
  return out;
}
