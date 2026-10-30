import * as XLSX from 'xlsx';
import { text } from '@/lib/reconciliation/normalize';
import { calendarDate } from '@/lib/reconciliation/parsers';
import { money } from '../normalize';
import { colIndex, findHeaderRow, sheetRows } from './shared';

// Real header (Time Office Out Report.xlsx, sheet "TimeOutOffice") — the
// outward weighment record:
// GatePass No | Date | Supplier Order No | Product Name | Invoice Number |
// Invoice Date | Customer Name | Customer Address | Customer Location |
// Vehicle No | Gunny Bags | Plastic Bags | Total Bags | Gross Weight | Tare Weight | Net Weight | Remarks

export type ParsedTimeOfficeOutRow = {
  gatePassNo: string; weighmentDate: string; soNo: string; productRaw: string; customerName: string; vehicleNo: string;
  gunnyBags: number | null; plasticBags: number | null; totalBags: number | null; grossWeight: number | null; tareWeight: number | null; netWeight: number | null; remarks: string;
};

export function parseTimeOfficeOut(book: XLSX.WorkBook): ParsedTimeOfficeOutRow[] {
  let sheet = book.SheetNames.find(s => /timeoutoffice|timeofficeout/i.test(s)) || book.SheetNames[0];
  let rows = sheetRows(book, sheet);
  let hi = findHeaderRow(rows, [['GatePass No'], ['Customer Name'], ['Net Weight']]);
  if (hi < 0) for (const s of book.SheetNames) { const r = sheetRows(book, s); const h = findHeaderRow(r, [['GatePass No'], ['Net Weight']]); if (h >= 0) { sheet = s; rows = r; hi = h; break; } }
  if (hi < 0) throw new Error('Time Office Out Report: could not locate the header row (GatePass No / Net Weight).');
  const head = rows[hi];
  const idx = {
    gp: colIndex(head, ['GatePass No']), date: colIndex(head, ['Date']), so: colIndex(head, ['Supplier Order No']), product: colIndex(head, ['Product Name']),
    customer: colIndex(head, ['Customer Name']), vehicle: colIndex(head, ['Vehicle No']),
    gunny: colIndex(head, ['Gunny Bags']), plastic: colIndex(head, ['Plastic Bags']), total: colIndex(head, ['Total Bags']),
    gross: colIndex(head, ['Gross Weight']), tare: colIndex(head, ['Tare Weight']), net: colIndex(head, ['Net Weight']), remarks: colIndex(head, ['Remarks']),
  };
  const out: ParsedTimeOfficeOutRow[] = [];
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r];
    const gatePassNo = text(row?.[idx.gp]);
    if (!gatePassNo) continue;
    out.push({
      gatePassNo, weighmentDate: calendarDate(row[idx.date]), soNo: text(row[idx.so]), productRaw: text(row[idx.product]), customerName: text(row[idx.customer]), vehicleNo: text(row[idx.vehicle]),
      gunnyBags: money(row[idx.gunny]), plasticBags: money(row[idx.plastic]), totalBags: money(row[idx.total]), grossWeight: money(row[idx.gross]), tareWeight: money(row[idx.tare]), netWeight: money(row[idx.net]), remarks: text(row[idx.remarks]),
    });
  }
  if (!out.length) throw new Error('Time Office Out Report: no data rows found under the header.');
  return out;
}
