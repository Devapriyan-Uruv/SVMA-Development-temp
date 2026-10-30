import * as XLSX from 'xlsx';
import { text } from '@/lib/reconciliation/normalize';
import { isBlank } from '../normalize';

export const header = (v: unknown) => text(v).toLowerCase().replace(/[^a-z0-9]/g, '');
export function colIndex(row: unknown[], aliases: string[]): number {
  const wanted = aliases.map(header);
  return row.findIndex(cell => wanted.includes(header(cell)));
}
export function sheetRows(book: XLSX.WorkBook, sheet: string): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[sheet], { header: 1, raw: true, defval: null });
}
/** Locate the header row by content (searches the first N rows for a row
 * containing every alias group) rather than a hardcoded row index — same
 * resilience approach as lib/reconciliation/parsers.ts::findTable, needed
 * because these ERP exports carry a variable-height title/letterhead block
 * before the real header. */
export function findHeaderRow(rows: unknown[][], requiredGroups: string[][], searchRows = 20): number {
  return rows.slice(0, searchRows).findIndex(row => requiredGroups.every(aliases => colIndex(row, aliases) >= 0));
}
/** A row is a "total"/blank trailer row if its designated key column is empty. */
export function isDataRow(row: unknown[] | undefined, keyIdx: number): boolean {
  return !!row && !isBlank(row[keyIdx]);
}
