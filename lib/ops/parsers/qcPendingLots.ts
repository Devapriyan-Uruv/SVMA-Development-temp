import * as XLSX from 'xlsx';
import { text } from '@/lib/reconciliation/normalize';
import { calendarDate } from '@/lib/reconciliation/parsers';
import { money } from '../normalize';
import { colIndex, findHeaderRow, sheetRows } from './shared';

// Real header (QCPendingLotsSVMAAdmin...xlsx, sheet "INQCPendingLots"),
// confirmed live: ReferenceNo | Date | PartyName | ProductName | LotNumber
// | Codes | Quantity. Codes is a comma-joined list of sample codes for
// that lot. LotNumber is the natural business key — a lot enters "QC
// pending" once, complementing the existing Inward QC / Settlement
// reconciliation rather than replacing it.

export type ParsedQcPendingLotRow = {
  referenceNo: string; pendingDate: string; partyName: string; productRaw: string;
  lotNo: string; codes: string; quantity: number | null;
};

export function parseQcPendingLots(book: XLSX.WorkBook): ParsedQcPendingLotRow[] {
  let sheet = book.SheetNames.find(s => /qcpending/i.test(s)) || book.SheetNames[0];
  let rows = sheetRows(book, sheet);
  let hi = findHeaderRow(rows, [['ReferenceNo'], ['LotNumber'], ['Quantity']]);
  if (hi < 0) for (const s of book.SheetNames) { const r = sheetRows(book, s); const h = findHeaderRow(r, [['ReferenceNo'], ['LotNumber']]); if (h >= 0) { sheet = s; rows = r; hi = h; break; } }
  if (hi < 0) throw new Error('QC Pending Lots: could not locate the header row (ReferenceNo / LotNumber).');
  const head = rows[hi];
  const idx = {
    ref: colIndex(head, ['ReferenceNo']), date: colIndex(head, ['Date']), party: colIndex(head, ['PartyName']),
    product: colIndex(head, ['ProductName']), lot: colIndex(head, ['LotNumber']), codes: colIndex(head, ['Codes']), qty: colIndex(head, ['Quantity']),
  };
  if (idx.lot < 0) throw new Error('QC Pending Lots: header row is missing LotNumber.');

  const out: ParsedQcPendingLotRow[] = [];
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r];
    const lotNo = text(row?.[idx.lot]);
    if (!lotNo) continue;
    out.push({
      referenceNo: text(row[idx.ref]), pendingDate: calendarDate(row[idx.date]), partyName: text(row[idx.party]),
      productRaw: text(row[idx.product]), lotNo, codes: text(row[idx.codes]), quantity: money(row[idx.qty]),
    });
  }
  if (!out.length) throw new Error('QC Pending Lots: no data rows found under the header.');
  return out;
}
