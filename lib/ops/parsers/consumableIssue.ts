import * as XLSX from 'xlsx';
import { text } from '@/lib/reconciliation/normalize';
import { calendarDate } from '@/lib/reconciliation/parsers';
import { money } from '../normalize';
import { colIndex, findHeaderRow, sheetRows } from './shared';

// Real header (Consumable IssueSVMAAdmin...xlsx, sheet "ConsumableIssue"),
// confirmed live: Date | ReferenceNo | Department | ProductName | Weight.
// One row per material issued against a reference (e.g. "CI/882/26-27"
// covers both "Fire wood" and "Hexane" as separate rows) — plain
// per-department utility/consumable usage log.

export type ParsedConsumableIssueRow = {
  issueDate: string; referenceNo: string; department: string; productRaw: string; weight: number | null;
};

export function parseConsumableIssue(book: XLSX.WorkBook): ParsedConsumableIssueRow[] {
  let sheet = book.SheetNames.find(s => /consumable/i.test(s)) || book.SheetNames[0];
  let rows = sheetRows(book, sheet);
  let hi = findHeaderRow(rows, [['ReferenceNo'], ['Department'], ['ProductName']]);
  if (hi < 0) for (const s of book.SheetNames) { const r = sheetRows(book, s); const h = findHeaderRow(r, [['ReferenceNo'], ['ProductName']]); if (h >= 0) { sheet = s; rows = r; hi = h; break; } }
  if (hi < 0) throw new Error('Consumable Issue: could not locate the header row (ReferenceNo / ProductName).');
  const head = rows[hi];
  const idx = {
    date: colIndex(head, ['Date']), ref: colIndex(head, ['ReferenceNo']), dept: colIndex(head, ['Department']),
    product: colIndex(head, ['ProductName']), weight: colIndex(head, ['Weight']),
  };
  if ([idx.ref, idx.product].some(i => i < 0)) throw new Error('Consumable Issue: header row is missing ReferenceNo or ProductName.');

  const out: ParsedConsumableIssueRow[] = [];
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r];
    const referenceNo = text(row?.[idx.ref]);
    const productRaw = text(row?.[idx.product]);
    if (!referenceNo || !productRaw) continue;
    out.push({ issueDate: calendarDate(row[idx.date]), referenceNo, department: text(row[idx.dept]), productRaw, weight: money(row[idx.weight]) });
  }
  if (!out.length) throw new Error('Consumable Issue: no data rows found under the header.');
  return out;
}
