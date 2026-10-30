import * as XLSX from 'xlsx';
import { text } from '@/lib/reconciliation/normalize';
import { calendarDate } from '@/lib/reconciliation/parsers';
import { money } from '../normalize';
import { colIndex, findHeaderRow, sheetRows } from './shared';

// Real header (ShutDownSVMAAdmin...xlsx, sheet "ShutDown"), confirmed
// live: Effective Date | Reason | From Time | To Time | Minutes |
// Cumulative | Remarks. A small, low-volume plant-downtime log (17 rows
// in the real sample for a full month). No reference number exists, so
// the business key is the composite (effective date, from time, to time)
// — two genuinely different shutdowns on the same day always differ on
// at least one of those.

export type ParsedShutDownRow = {
  effectiveDate: string; reason: string; fromTime: string; toTime: string;
  minutes: number | null; cumulative: string; remarks: string;
};

export function parseShutDown(book: XLSX.WorkBook): ParsedShutDownRow[] {
  let sheet = book.SheetNames.find(s => /shutdown/i.test(s)) || book.SheetNames[0];
  let rows = sheetRows(book, sheet);
  let hi = findHeaderRow(rows, [['Effective Date'], ['Reason'], ['Minutes']]);
  if (hi < 0) for (const s of book.SheetNames) { const r = sheetRows(book, s); const h = findHeaderRow(r, [['Effective Date'], ['Minutes']]); if (h >= 0) { sheet = s; rows = r; hi = h; break; } }
  if (hi < 0) throw new Error('Shut Down: could not locate the header row (Effective Date / Minutes).');
  const head = rows[hi];
  const idx = {
    date: colIndex(head, ['Effective Date']), reason: colIndex(head, ['Reason']), from: colIndex(head, ['From Time']),
    to: colIndex(head, ['To Time']), minutes: colIndex(head, ['Minutes']), cumulative: colIndex(head, ['Cumulative']), remarks: colIndex(head, ['Remarks']),
  };
  if (idx.date < 0) throw new Error('Shut Down: header row is missing Effective Date.');

  const out: ParsedShutDownRow[] = [];
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r];
    const effectiveDate = calendarDate(row?.[idx.date]);
    if (!effectiveDate) continue;
    out.push({
      effectiveDate, reason: text(row[idx.reason]), fromTime: text(row[idx.from]), toTime: text(row[idx.to]),
      minutes: money(row[idx.minutes]), cumulative: text(row[idx.cumulative]), remarks: text(row[idx.remarks]),
    });
  }
  if (!out.length) throw new Error('Shut Down: no data rows found under the header.');
  return out;
}
