import * as XLSX from 'xlsx';
import { text } from '@/lib/reconciliation/normalize';
import { calendarDate } from '@/lib/reconciliation/parsers';
import { isBlank, money } from '../normalize';
import { colIndex, findHeaderRow, sheetRows } from './shared';

// Real header (Sales Register.xlsx, sheet "SalesDetails"):
// S.No | Invoice No | SaleOrderNo | CustomerPoNo | InvoiceDate | Party Name |
// Place | VehicleNo | ProductName | PackingSize | Rate | Quantity MT/No's |
// Quantity KG/Ltr | PlasticBag | JuteBag | TotalBag's | Amount | ... | Total InvoiceAmount

export type ParsedSalesRegisterRow = {
  invoiceNo: string; soNo: string; invoiceDate: string; partyName: string; place: string; vehicleNo: string;
  productRaw: string; packingSize: string; rate: number | null; quantityMt: number | null; quantityKg: number | null;
  plasticBag: number | null; juteBag: number | null; totalBags: number | null; amount: number | null; taxAmount: number | null; totalInvoiceAmount: number | null;
};

// Confirmed against the real file: a few of this sheet's headers (Quantity
// MT/No's, Quantity KG/Ltr, JuteBag, TotalBag's) sit over a genuinely
// merged/shifted cell — the LABEL is one column right of where that row's
// actual value lives whenever the column directly before the label is
// itself blank in the header. Read defensively: if the labeled cell is
// empty for a given row but the blank column immediately to its left has a
// value, use that instead — never applied unless both conditions hold, so
// a well-behaved column (or a row that's genuinely blank there) is untouched.
function readShifted(row: unknown[], head: unknown[], idx: number): unknown {
  if (idx < 0) return null;
  if (!isBlank(row[idx])) return row[idx];
  if (idx > 0 && isBlank(head[idx - 1]) && !isBlank(row[idx - 1])) return row[idx - 1];
  return row[idx];
}
// "Quantity KG/Ltr" sits on the OTHER side of the same merged-cell pattern
// as "Quantity MT/No's" — confirmed against every row in the real file (not
// an occasional glitch): the labeled cell is always blank, and its real
// value always sits one column to the RIGHT, in the blank spacer before
// PlasticBag. Mirrors readShifted but checks the opposite direction.
function readShiftedRight(row: unknown[], head: unknown[], idx: number): unknown {
  if (idx < 0) return null;
  if (!isBlank(row[idx])) return row[idx];
  if (idx + 1 < head.length && isBlank(head[idx + 1]) && !isBlank(row[idx + 1])) return row[idx + 1];
  return row[idx];
}

export function parseSalesRegister(book: XLSX.WorkBook): ParsedSalesRegisterRow[] {
  let sheet = book.SheetNames.find(s => /salesdetails/i.test(s)) || book.SheetNames[0];
  let rows = sheetRows(book, sheet);
  let hi = findHeaderRow(rows, [['Invoice No'], ['Party Name'], ['VehicleNo', 'Vehicle No']]);
  if (hi < 0) for (const s of book.SheetNames) { const r = sheetRows(book, s); const h = findHeaderRow(r, [['Invoice No'], ['Party Name']]); if (h >= 0) { sheet = s; rows = r; hi = h; break; } }
  if (hi < 0) throw new Error('Sales Register: could not locate the header row (Invoice No / Party Name).');
  const head = rows[hi];
  const idx = {
    invoice: colIndex(head, ['Invoice No']), so: colIndex(head, ['SaleOrderNo']), date: colIndex(head, ['InvoiceDate']), party: colIndex(head, ['Party Name']),
    place: colIndex(head, ['Place']), vehicle: colIndex(head, ['VehicleNo', 'Vehicle No']), product: colIndex(head, ['ProductName']), packing: colIndex(head, ['PackingSize']),
    rate: colIndex(head, ['Rate']), qtyMt: colIndex(head, ["Quantity \nMT/No's", 'Quantity MT/No\'s']), qtyKg: colIndex(head, ['Quantity KG/Ltr']),
    plastic: colIndex(head, ['PlasticBag']), jute: colIndex(head, ['JuteBag']), totalBags: colIndex(head, ["TotalBag's", 'TotalBags']),
    amount: colIndex(head, ['Amount']), taxAmount: colIndex(head, ['TaxAmount']), total: colIndex(head, ['Total InvoiceAmount']),
  };
  const out: ParsedSalesRegisterRow[] = [];
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r];
    const invoiceNo = text(row?.[idx.invoice]);
    if (!invoiceNo) continue;
    out.push({
      invoiceNo, soNo: text(row[idx.so]), invoiceDate: calendarDate(row[idx.date]), partyName: text(row[idx.party]), place: text(row[idx.place]), vehicleNo: text(row[idx.vehicle]),
      productRaw: text(row[idx.product]), packingSize: text(row[idx.packing]), rate: money(row[idx.rate]), quantityMt: money(readShifted(row, head, idx.qtyMt)), quantityKg: money(readShiftedRight(row, head, idx.qtyKg)),
      plasticBag: money(row[idx.plastic]), juteBag: money(readShifted(row, head, idx.jute)), totalBags: money(readShifted(row, head, idx.totalBags)), amount: money(row[idx.amount]), taxAmount: money(row[idx.taxAmount]), totalInvoiceAmount: money(row[idx.total]),
    });
  }
  if (!out.length) throw new Error('Sales Register: no data rows found under the header.');
  return out;
}
