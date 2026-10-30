import * as XLSX from 'xlsx';
import { text } from '@/lib/reconciliation/normalize';
import { calendarDate } from '@/lib/reconciliation/parsers';
import { money } from '../normalize';
import { colIndex, findHeaderRow, sheetRows } from './shared';

// Real structure (EBPowerReadingReportSVMAAdmin...xlsx, sheet
// "EBPowerReading"), confirmed live: a date-only row ("01/09/2026") starts
// each day's block; a department-only row ("Refinery", "Solvent", "Soya")
// starts each department's block within that day; the S.No/Particulars/
// Opening KWH/Closing KWH/Consumption Units header then REPEATS for every
// department block (unlike Stock Summary's single-header-then-category-
// rows shape); each block ends with a "TotalConsumption: N" trailer.
// After the last department block, several PLANT-LEVEL summary rows follow
// (LT Meter reading, Generator Reading, Total, Plant Total, Different, HT
// KWH Reading, LT Consumption, Transformer UnitLoss, HT KVA Reading P.F,
// E.B MD) before the next date starts — these are aggregates, not
// per-equipment readings, and are deliberately excluded here.

const SUMMARY_LABEL_RE = /^total(consumption)?\b|^lt meter|^generator|^plant total|^different\b|^ht kwh|^lt consumption|^transformer|^ht kva|^e\.?b md/i;

export type ParsedEbPowerReadingRow = {
  reportDate: string; department: string; particulars: string;
  openingKwh: number | null; closingKwh: number | null; consumptionUnits: number | null; remarks: string;
};

export function parseEbPowerReading(book: XLSX.WorkBook): ParsedEbPowerReadingRow[] {
  let sheet = book.SheetNames.find(s => /ebpower/i.test(s)) || book.SheetNames[0];
  let rows = sheetRows(book, sheet);
  let hi = findHeaderRow(rows, [['S.No'], ['Particulars'], ['Consumption Units']]);
  if (hi < 0) for (const s of book.SheetNames) { const r = sheetRows(book, s); const h = findHeaderRow(r, [['S.No'], ['Particulars']]); if (h >= 0) { sheet = s; rows = r; hi = h; break; } }
  if (hi < 0) throw new Error('EB Power Reading: could not locate the header row (S.No / Particulars).');
  const head = rows[hi];
  const idx = {
    sno: colIndex(head, ['S.No']), particulars: colIndex(head, ['Particulars']), opening: colIndex(head, ['Opening KWH Reading']),
    closing: colIndex(head, ['Closing KWH Cumulative Reading']), consumption: colIndex(head, ['Consumption Units']), remarks: colIndex(head, ['Remarks']),
  };
  if ([idx.sno, idx.particulars].some(i => i < 0)) throw new Error('EB Power Reading: header row is missing S.No or Particulars.');

  const out: ParsedEbPowerReadingRow[] = [];
  let reportDate = '', department = '';
  // Starts from row 0, not hi: the first date/department label of the
  // whole file sits BEFORE the first header row (confirmed live —
  // "01/09/2026" then "Refinery" both precede the first S.No/Particulars
  // header) — starting at hi silently lost that first block's date and
  // department, leaving every row in it blank until the next label.
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const first = text(row?.[0]);
    if (!first) continue;
    if (first.toUpperCase() === 'S.NO') continue; // the header repeats per department block
    const asDate = calendarDate(first);
    if (asDate && !text(row[idx.particulars])) { reportDate = asDate; department = ''; continue; }
    const sno = text(row[idx.sno]);
    const particulars = text(row[idx.particulars]);
    if (/^\d+$/.test(sno) && particulars) {
      out.push({
        reportDate, department, particulars,
        openingKwh: money(row[idx.opening]), closingKwh: money(row[idx.closing]), consumptionUnits: money(row[idx.consumption]), remarks: text(row[idx.remarks]),
      });
      continue;
    }
    if (!SUMMARY_LABEL_RE.test(first)) department = first; // a genuine department-block label
  }
  if (!out.length) throw new Error('EB Power Reading: no data rows found under the header.');
  return out;
}
