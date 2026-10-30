import * as XLSX from 'xlsx';
import { text } from '@/lib/reconciliation/normalize';
import { calendarDate } from '@/lib/reconciliation/parsers';
import { money } from '../normalize';
import { colIndex, findHeaderRow, sheetRows } from './shared';

// Real header (SettlementPending Lot.xlsx, sheet "Setpen"):
// PurchaseType | Reference No | Inward Date | Product Name | Lotnumber |
// Supplier Name | Quantity | FFA | FIBER | IV | MOI | OIL | SS

export type ParsedSettlementRow = {
  purchaseType: string; referenceNo: string; inwardDate: string; productRaw: string; lotNo: string; supplierName: string;
  quantity: number | null; ffa: number | null; fiber: number | null; iv: number | null; moi: number | null; oil: number | null; ss: number | null;
};

export function parseSettlementPending(book: XLSX.WorkBook): { asOfDate: string; rows: ParsedSettlementRow[] } {
  let sheet = book.SheetNames.find(s => /setpen/i.test(s)) || book.SheetNames[0];
  let rows = sheetRows(book, sheet);
  let hi = findHeaderRow(rows, [['Reference No'], ['Lotnumber', 'Lot Number'], ['Quantity']]);
  if (hi < 0) for (const s of book.SheetNames) { const r = sheetRows(book, s); const h = findHeaderRow(r, [['Reference No'], ['Quantity']]); if (h >= 0) { sheet = s; rows = r; hi = h; break; } }
  if (hi < 0) throw new Error('SettlementPending Lot: could not locate the header row (Reference No / Quantity).');
  const head = rows[hi];
  // "As on Date" in the title block — this is a pending-as-of-today
  // snapshot, distinct from each row's own (often much older) Inward Date.
  const titleText = text(rows.slice(0, 8).flat().find(c => /as\s*on\s*date/i.test(text(c))));
  const asOfMatch = titleText.match(/(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})/);
  const asOfDate = asOfMatch ? calendarDate(asOfMatch[1]) : '';
  const idx = {
    type: colIndex(head, ['PurchaseType']), ref: colIndex(head, ['Reference No']), date: colIndex(head, ['Inward Date']), product: colIndex(head, ['Product Name']),
    lot: colIndex(head, ['Lotnumber', 'Lot Number']), supplier: colIndex(head, ['Supplier Name']), qty: colIndex(head, ['Quantity']),
    ffa: colIndex(head, ['FFA']), fiber: colIndex(head, ['FIBER']), iv: colIndex(head, ['IV']), moi: colIndex(head, ['MOI']), oil: colIndex(head, ['OIL']), ss: colIndex(head, ['SS']),
  };
  const out: ParsedSettlementRow[] = [];
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r];
    const referenceNo = text(row?.[idx.ref]);
    if (!referenceNo) continue;
    out.push({
      purchaseType: text(row[idx.type]), referenceNo, inwardDate: calendarDate(row[idx.date]), productRaw: text(row[idx.product]), lotNo: text(row[idx.lot]), supplierName: text(row[idx.supplier]),
      quantity: money(row[idx.qty]), ffa: money(row[idx.ffa]), fiber: money(row[idx.fiber]), iv: money(row[idx.iv]), moi: money(row[idx.moi]), oil: money(row[idx.oil]), ss: money(row[idx.ss]),
    });
  }
  if (!out.length) throw new Error('SettlementPending Lot: no data rows found under the header.');
  if (!asOfDate) throw new Error('SettlementPending Lot: could not detect the "As on Date" snapshot date from the report title.');
  return { asOfDate, rows: out };
}
