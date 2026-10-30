import * as XLSX from 'xlsx';
import { text } from '@/lib/reconciliation/normalize';
import { calendarDate } from '@/lib/reconciliation/parsers';
import { isBlank, money } from '../normalize';
import { colIndex, findHeaderRow, sheetRows } from './shared';

// Real header (Stock Summary with Value.xlsx / ERP STOCK <date>.xlsx, sheet
// "StockSummaryReport") spans TWO rows:
//   row A: Particulars | | Packing | Packing | Opening Balance | Inwards | Outwards | Closing Balance | | | Closing Balance |
//   row B: | | Size | Name | Quantity | Quantity | Quantity | Quantity | | | stock |
// The quantity/value columns are structurally fixed offsets from the
// "Particulars" column in this export template, so once the header row is
// located BY CONTENT (not a hardcoded row number), the four quantity columns
// and the value column are read by offset rather than by re-matching the
// ambiguous repeated "Quantity" sub-labels.
const OFFSET = { packingSize: 2, packingName: 3, opening: 4, inward: 5, outward: 6, closing: 7, value: 10 };

export type ParsedStockSnapshotRow = {
  category: string; particulars: string; packingSize: string; packingName: string;
  openingQty: number | null; inwardQty: number | null; outwardQty: number | null; closingQty: number | null; closingValue: number | null;
};

export function parseStockSummary(book: XLSX.WorkBook): { reportDate: string; rows: ParsedStockSnapshotRow[] } {
  let sheet = book.SheetNames.find(s => /stocksummary/i.test(s)) || book.SheetNames[0];
  let rows = sheetRows(book, sheet);
  let hi = findHeaderRow(rows, [['Particulars'], ['Opening Balance', 'Opening']]);
  if (hi < 0) for (const s of book.SheetNames) { const r = sheetRows(book, s); const h = findHeaderRow(r, [['Particulars']]); if (h >= 0) { sheet = s; rows = r; hi = h; break; } }
  if (hi < 0) throw new Error('Stock Summary: could not locate the header row (Particulars / Opening Balance).');
  const head = rows[hi];
  const particularsIdx = colIndex(head, ['Particulars']);
  if (particularsIdx < 0) throw new Error('Stock Summary: "Particulars" column not found.');
  const idx = {
    particulars: particularsIdx, packingSize: particularsIdx + OFFSET.packingSize, packingName: particularsIdx + OFFSET.packingName,
    opening: particularsIdx + OFFSET.opening, inward: particularsIdx + OFFSET.inward, outward: particularsIdx + OFFSET.outward,
    closing: particularsIdx + OFFSET.closing, value: particularsIdx + OFFSET.value,
  };

  const titleText = text(rows.slice(0, 5).flat().find(c => /from\s*date|as\s*on\s*date/i.test(text(c))));
  const dates = [...titleText.matchAll(/(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})/g)].map(m => calendarDate(m[1])).filter(Boolean);
  const reportDate = dates[dates.length - 1] || dates[0] || '';

  const out: ParsedStockSnapshotRow[] = [];
  let category = '';
  for (let r = hi + 2; r < rows.length; r++) {
    const row = rows[r];
    const particulars = text(row?.[idx.particulars]);
    if (!particulars) continue;
    const quantitiesBlank = [idx.opening, idx.inward, idx.outward, idx.closing].every(i => isBlank(row[i]));
    if (quantitiesBlank) { category = particulars; continue; }
    out.push({
      category, particulars, packingSize: text(row[idx.packingSize]), packingName: text(row[idx.packingName]),
      openingQty: money(row[idx.opening]), inwardQty: money(row[idx.inward]), outwardQty: money(row[idx.outward]),
      closingQty: money(row[idx.closing]), closingValue: money(row[idx.value]),
    });
  }
  if (!out.length) throw new Error('Stock Summary: no data rows found under the header.');
  if (!reportDate) throw new Error('Stock Summary: could not detect the report date from the title block.');
  return { reportDate, rows: out };
}
