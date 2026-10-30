import * as XLSX from 'xlsx';
import { text } from '@/lib/reconciliation/normalize';
import { calendarDate } from '@/lib/reconciliation/parsers';
import { money } from '../normalize';
import { colIndex, findHeaderRow, sheetRows } from './shared';

// Real header (Time Office In Report.xlsx, sheet "TimeOffice") — this IS
// the inward weighment record (carries Lot No + Gross/Tare/Net Weight):
// GatePass No | Date | Purchase Order No | Material Name | Lot No |
// Invoice Number | Invoice Date | Supplier Name | Supplier Address |
// Vehicle No | Gunny Bags | Plastic Bags | Total Bags | Gross Weight | Tare Weight | Net Weight | Remarks

export type ParsedTimeOfficeInRow = {
  gatePassNo: string; weighmentDate: string; poNo: string; productRaw: string; lotNo: string; supplierName: string; vehicleNo: string;
  gunnyBags: number | null; plasticBags: number | null; totalBags: number | null; grossWeight: number | null; tareWeight: number | null; netWeight: number | null; remarks: string;
};

export function parseTimeOfficeIn(book: XLSX.WorkBook): ParsedTimeOfficeInRow[] {
  let sheet = book.SheetNames.find(s => /timeoffice/i.test(s) && !/out/i.test(s)) || book.SheetNames[0];
  let rows = sheetRows(book, sheet);
  let hi = findHeaderRow(rows, [['GatePass No'], ['Lot No'], ['Net Weight']]);
  if (hi < 0) for (const s of book.SheetNames) { const r = sheetRows(book, s); const h = findHeaderRow(r, [['GatePass No'], ['Net Weight']]); if (h >= 0) { sheet = s; rows = r; hi = h; break; } }
  if (hi < 0) throw new Error('Time Office In Report: could not locate the header row (GatePass No / Net Weight).');
  const head = rows[hi];
  const idx = {
    gp: colIndex(head, ['GatePass No']), date: colIndex(head, ['Date']), po: colIndex(head, ['Purchase Order No']), material: colIndex(head, ['Material Name']),
    lot: colIndex(head, ['Lot No']), supplier: colIndex(head, ['Supplier Name']), vehicle: colIndex(head, ['Vehicle No']),
    gunny: colIndex(head, ['Gunny Bags']), plastic: colIndex(head, ['Plastic Bags']), total: colIndex(head, ['Total Bags']),
    gross: colIndex(head, ['Gross Weight']), tare: colIndex(head, ['Tare Weight']), net: colIndex(head, ['Net Weight']), remarks: colIndex(head, ['Remarks']),
  };
  const out: ParsedTimeOfficeInRow[] = [];
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r];
    const gatePassNo = text(row?.[idx.gp]);
    if (!gatePassNo) continue;
    out.push({
      gatePassNo, weighmentDate: calendarDate(row[idx.date]), poNo: text(row[idx.po]), productRaw: text(row[idx.material]), lotNo: text(row[idx.lot]), supplierName: text(row[idx.supplier]), vehicleNo: text(row[idx.vehicle]),
      gunnyBags: money(row[idx.gunny]), plasticBags: money(row[idx.plastic]), totalBags: money(row[idx.total]), grossWeight: money(row[idx.gross]), tareWeight: money(row[idx.tare]), netWeight: money(row[idx.net]), remarks: text(row[idx.remarks]),
    });
  }
  if (!out.length) throw new Error('Time Office In Report: no data rows found under the header.');
  return out;
}
