import * as XLSX from 'xlsx';
import { text } from '@/lib/reconciliation/normalize';
import { calendarDate } from '@/lib/reconciliation/parsers';
import { money } from '../normalize';
import { colIndex, findHeaderRow, sheetRows } from './shared';

// Real header (FreightSummarySVMAAdmin...xlsx, sheet "FreightSum"),
// confirmed live: S.No | InvoiceNo | InvoiceDate | Party Name |
// Invoice Location | VehicleNo | ProductName | InvoiceQty |
// FreightAmt(per ton). One row per dispatch invoice — InvoiceNo is the
// natural business key (same numbering convention as Sales Register).

export type ParsedFreightSummaryRow = {
  invoiceNo: string; invoiceDate: string; partyName: string; invoiceLocation: string;
  vehicleNo: string; productRaw: string; invoiceQty: number | null; freightAmtPerTon: number | null;
};

export function parseFreightSummary(book: XLSX.WorkBook): ParsedFreightSummaryRow[] {
  let sheet = book.SheetNames.find(s => /freight/i.test(s)) || book.SheetNames[0];
  let rows = sheetRows(book, sheet);
  let hi = findHeaderRow(rows, [['InvoiceNo'], ['Party Name'], ['VehicleNo']]);
  if (hi < 0) for (const s of book.SheetNames) { const r = sheetRows(book, s); const h = findHeaderRow(r, [['InvoiceNo'], ['VehicleNo']]); if (h >= 0) { sheet = s; rows = r; hi = h; break; } }
  if (hi < 0) throw new Error('Freight Summary: could not locate the header row (InvoiceNo / VehicleNo).');
  const head = rows[hi];
  const idx = {
    invoiceNo: colIndex(head, ['InvoiceNo']), invoiceDate: colIndex(head, ['InvoiceDate']), party: colIndex(head, ['Party Name']),
    location: colIndex(head, ['Invoice Location']), vehicle: colIndex(head, ['VehicleNo']), product: colIndex(head, ['ProductName']),
    qty: colIndex(head, ['InvoiceQty']), freight: colIndex(head, ['FreightAmt(per ton)', 'FreightAmt']),
  };
  if (idx.invoiceNo < 0) throw new Error('Freight Summary: header row is missing InvoiceNo.');

  const out: ParsedFreightSummaryRow[] = [];
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r];
    const invoiceNo = text(row?.[idx.invoiceNo]);
    if (!invoiceNo) continue;
    out.push({
      invoiceNo, invoiceDate: calendarDate(row[idx.invoiceDate]), partyName: text(row[idx.party]), invoiceLocation: text(row[idx.location]),
      vehicleNo: text(row[idx.vehicle]), productRaw: text(row[idx.product]), invoiceQty: money(row[idx.qty]), freightAmtPerTon: money(row[idx.freight]),
    });
  }
  if (!out.length) throw new Error('Freight Summary: no data rows found under the header.');
  return out;
}
