import * as XLSX from 'xlsx';
import { text } from '@/lib/reconciliation/normalize';
import { calendarDate } from '@/lib/reconciliation/parsers';
import { money } from '../normalize';
import { colIndex, findHeaderRow, sheetRows } from './shared';

// Real structure (Solvent Daily ReportSVMAAdmin...xlsx, sheet
// "SolventDays"), confirmed live: a "DATE ... SHIFT ..." row starts each
// shift block, followed by a two-row merged header (group labels then
// sub-labels, same two-row-header shape as stockSummary.ts) that REPEATS
// for every shift block, then hourly TIME rows, then an "AVG" trailer.
// Confirmed live this source data is genuinely messy — the same TIME
// label (e.g. "2.00PM") can appear more than once within one shift block
// (two stacked sub-tables in the same block rather than separate columns)
// — so (report_date, shift, time_slot) alone is NOT always unique; a
// per-(date,shift) occurrence counter (rowSeq) is added to disambiguate
// without discarding any real row. Only the columns I could confidently
// label from the real two-row header are named explicitly; the rest are
// kept verbatim in `extra` rather than guessed at — this is deliberately
// a separate, standalone cross-check log (per the explicit decision to
// build it despite overlapping the Solvent module's own manual entry and
// Quality's Process Lab Report), not a source of truth for either.

export type ParsedSolventDailyRow = {
  reportDate: string; shift: string; timeSlot: string; rowSeq: number;
  spray1Ffa: number | null; spray2Ffa: number | null; dobDocOilPct: number | null; miscella: number | null;
  productionOilFfa: number | null; iv: number | null; mv: number | null; flashPoint: number | null; remarks: string;
  extra: Record<string, string>;
};

export function parseSolventDailyReport(book: XLSX.WorkBook): ParsedSolventDailyRow[] {
  let sheet = book.SheetNames.find(s => /solventdays/i.test(s)) || book.SheetNames[0];
  let rows = sheetRows(book, sheet);
  let hi = findHeaderRow(rows, [['TIME'], ['MISCELLA']]);
  if (hi < 0) for (const s of book.SheetNames) { const r = sheetRows(book, s); const h = findHeaderRow(r, [['TIME'], ['MISCELLA']]); if (h >= 0) { sheet = s; rows = r; hi = h; break; } }
  if (hi < 0) throw new Error('Solvent Daily Report: could not locate the header row (TIME / MISCELLA).');
  const head = rows[hi];
  const idx = {
    time: colIndex(head, ['TIME']), spray1: 4, spray2: 5, oilPct: colIndex(head, ['%OIL']), miscella: colIndex(head, ['MISCELLA']),
    prodFfa: colIndex(head, ['FFA']), iv: colIndex(head, ['IV']), mv: colIndex(head, ['M/V']), flashPoint: colIndex(head, ['FL.PT']), remarks: colIndex(head, ['REMARKS']),
  };
  if (idx.time < 0) throw new Error('Solvent Daily Report: header row is missing TIME.');

  const out: ParsedSolventDailyRow[] = [];
  let reportDate = '', shift = '';
  const seqByKey = new Map<string, number>();
  // Starts from row 0, not hi: the first DATE/SHIFT row of the whole file
  // sits BEFORE the first header row (confirmed live — row 1 has "DATE
  // 01/09/2026 SHIFT Shift-A", the header is row 3) — starting at hi
  // silently lost that first block's date/shift, leaving its rows blank.
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const first = text(row?.[0]);
    if (first.toUpperCase() === 'DATE') { reportDate = calendarDate(row[1]); shift = text(row[5]); continue; }
    if (first.toUpperCase() === 'TIME' || !first || /^avg$/i.test(first)) continue; // header repeat, blank spacer row, or the AVG trailer
    if (!/^\d/.test(first)) continue; // not an hourly time row
    const key = `${reportDate}|${shift}`;
    const rowSeq = seqByKey.get(key) || 0;
    seqByKey.set(key, rowSeq + 1);
    const known = new Set([idx.time, idx.spray1, idx.spray2, idx.oilPct, idx.miscella, idx.prodFfa, idx.iv, idx.mv, idx.flashPoint, idx.remarks]);
    const extra: Record<string, string> = {};
    head.forEach((label: unknown, i: number) => { if (i > idx.time && !known.has(i) && text(label)) { const v = text(row[i]); if (v) extra[text(label)] = v; } });
    out.push({
      reportDate, shift, timeSlot: first, rowSeq,
      spray1Ffa: money(row[idx.spray1]), spray2Ffa: money(row[idx.spray2]), dobDocOilPct: money(row[idx.oilPct]), miscella: money(row[idx.miscella]),
      productionOilFfa: money(row[idx.prodFfa]), iv: money(row[idx.iv]), mv: money(row[idx.mv]), flashPoint: money(row[idx.flashPoint]), remarks: text(row[idx.remarks]),
      extra,
    });
  }
  if (!out.length) throw new Error('Solvent Daily Report: no data rows found under the header.');
  return out;
}
