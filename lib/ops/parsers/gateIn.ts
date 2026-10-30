import * as XLSX from 'xlsx';
import { text } from '@/lib/reconciliation/normalize';
import { calendarDate } from '@/lib/reconciliation/parsers';
import { colIndex, findHeaderRow, sheetRows } from './shared';

// Real header (Gate In Entry.xlsx, sheet "GateEntry"):
// GatePass No | Date | Purchase Order No | Invoice Number | Invoice Date |
// Supplier Name | Supplier Address | Material Name | Vehicle No | In Time | Out Time | Remarks

export type ParsedGateInRow = {
  gatePassNo: string; movementDate: string; poNo: string; supplierName: string; supplierAddress: string;
  materialRaw: string; vehicleNo: string; inTime: string; outTime: string; remarks: string;
};

export function parseGateIn(book: XLSX.WorkBook): ParsedGateInRow[] {
  let sheet = book.SheetNames.find(s => /gateentry/i.test(s)) || book.SheetNames[0];
  let rows = sheetRows(book, sheet);
  let hi = findHeaderRow(rows, [['GatePass No'], ['Supplier Name'], ['Vehicle No']]);
  if (hi < 0) for (const s of book.SheetNames) { const r = sheetRows(book, s); const h = findHeaderRow(r, [['GatePass No'], ['Vehicle No']]); if (h >= 0) { sheet = s; rows = r; hi = h; break; } }
  if (hi < 0) throw new Error('Gate In Entry: could not locate the header row (GatePass No / Vehicle No).');
  const head = rows[hi];
  const idx = {
    gp: colIndex(head, ['GatePass No']), date: colIndex(head, ['Date']), po: colIndex(head, ['Purchase Order No']),
    supplier: colIndex(head, ['Supplier Name']), address: colIndex(head, ['Supplier Address']), material: colIndex(head, ['Material Name']),
    vehicle: colIndex(head, ['Vehicle No']), inTime: colIndex(head, ['In Time']), outTime: colIndex(head, ['Out Time']), remarks: colIndex(head, ['Remarks']),
  };
  const out: ParsedGateInRow[] = [];
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r];
    const gatePassNo = text(row?.[idx.gp]);
    if (!gatePassNo) continue;
    out.push({
      gatePassNo, movementDate: calendarDate(row[idx.date]), poNo: text(row[idx.po]), supplierName: text(row[idx.supplier]), supplierAddress: text(row[idx.address]),
      materialRaw: text(row[idx.material]), vehicleNo: text(row[idx.vehicle]), inTime: text(row[idx.inTime]), outTime: text(row[idx.outTime]), remarks: text(row[idx.remarks]),
    });
  }
  if (!out.length) throw new Error('Gate In Entry: no data rows found under the header.');
  return out;
}
