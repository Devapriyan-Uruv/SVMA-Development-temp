import * as XLSX from 'xlsx';
import { text, toNumber } from '@/lib/reconciliation/normalize';
import { calendarDate, findTable } from '@/lib/reconciliation/parsers';

// Re-exported unchanged — Gate/Tally parsing already captures everything
// One Reconciliation needs (PO/SO reference as `order`/`orderRef`).
// Never edit lib/reconciliation/parsers.ts itself: this feature must not
// touch the existing Transaction Reconciliation pipeline.
export { parseGateUpload, parseTallyUpload } from '@/lib/reconciliation/parsers';
export type { Gate, TallyVoucher, Source } from '@/lib/reconciliation/parsers';

// lib/reconciliation/parsers.ts's own parseWeighmentUpload does not capture
// Lot No (confirmed live: no LOT alias list, no field on its Weighment
// type) — the real Weighment Register (26.Xls) has one, and it's the
// anchor for this feature's whole Lot->QC->Settlement->CN/DN chain-walk.
// Rather than edit the shared parser (forbidden — see above), this is a
// small, self-contained parser specific to this feature, same
// alias-lookup style as the original, with a `lot` field added.
const header = (v: unknown) => text(v).toLowerCase().replace(/[^a-z0-9]/g, '');
function colIndex(row: unknown[], aliases: string[]): number { return row.findIndex(cell => aliases.map(header).includes(header(cell))); }

const VEHICLES = ['Vehilce No', 'Vehicle No', 'Vehicle Number', 'Lorry No', 'Truck No'];
const REFS = ['Serial No', 'Weigh Bridge Ref No', 'Weighment No', 'Weighment Ref', 'Ticket No'];
// 'Name' alone is a real header in the plant's own Weighment Register
// export (its "Date-Wise Collection Register" layout) — the party/supplier
// column there is just headed "Name", not "Party Name". Safe to include:
// colIndex matches on the FULL normalized header text, so this only ever
// matches a column literally called "Name" (or "NAME", "Name:"), never
// "Product Name"/"Item Name" (those normalize to 'productname'/'itemname').
const PARTIES = ['Party Name', 'Party', 'Supplier Name', 'Name'];
const NET = ['Net Weight', 'NetWeight', 'Net Wt', 'Net Weight (kg)', 'Net Weight (Kgs)', 'Net'];
const LOTS = ['Lot No', 'Lot No.', 'Lot Number', 'LotNo'];
const IST = ['Ist Weight', '1st Weight', 'First Weight', 'Gross Weight'];
const IIND = ['IInd Weight', '2nd Weight', 'Second Weight', 'Tare Weight'];

export type WeighmentWithLot = { id: string; ref: string; vehicle: string; party: string; material: string; lot: string; weight: number | null; grossWeight: number | null; tareWeight: number | null; date: string; source: { file: string; sheet: string; row: number } };

// The plant's own "Date-Wise Collection Register" export doesn't carry a
// per-row Date column — it breaks the sheet into one section per day, each
// introduced by its own marker row (col 0 literally reads "Date :
// 01-Sep-2026", every other cell on that row blank). This never matches
// VEHICLES/REFS/PARTIES/Material so it's already skipped as a non-movement
// row below; DATE_MARKER exists purely to read the date back out of it
// before that skip, so every data row after it inherits the right day.
const DATE_MARKER = /^date\s*:?\s*(.+)$/i;

// The same report prints running totals as ordinary-looking rows: a "Total Amount" line after each day and
// "Total Amount" / "Net Total" at the end. Those sit in the Vehicle column, so they pass for a truck and must
// be recognised by label (never by position or weight) and dropped before reconciliation.
const TOTAL_LABEL = /^(grand\s+total|net\s+total|total\s+amount|total\s+values?|sub\s*total|total)$/i;
// "For The Period From : 01-Sep-2026 To 30-Sep-2026" — a one-day, one-week or one-month export all carry this line.
const PERIOD = /from\s*:?\s*(\d{1,2}[-/.][A-Za-z0-9]{1,9}[-/.]\d{2,4}|\d{4}-\d{2}-\d{2})\s+to\s*:?\s*(\d{1,2}[-/.][A-Za-z0-9]{1,9}[-/.]\d{2,4}|\d{4}-\d{2}-\d{2})/i;

export function parseWeighmentWithLot(book: XLSX.WorkBook, file: string, selectedDate = ''): { rows: WeighmentWithLot[]; date: string; notes: string[] } {
  const t = findTable(book, [VEHICLES, REFS, ['Material', 'Material Name'], PARTIES]);
  if (!t) throw new Error('SCHEMA_REVIEW_REQUIRED: Weighment Register — required columns (Vehicle No, Serial No, Material, Party Name) were not found in any sheet.');
  const h = t.headers, vi = colIndex(h, VEHICLES), ri = colIndex(h, REFS), pi = colIndex(h, PARTIES), mi = colIndex(h, ['Material', 'Material Name']), wi = colIndex(h, NET), di = colIndex(h, ['Date', 'Weighment Date']), li = colIndex(h, LOTS), gi = colIndex(h, IST), ti = colIndex(h, IIND);
  if (wi < 0) throw new Error('SCHEMA_REVIEW_REQUIRED: Weighment Register — Net Weight column is required.');
  const title = t.rows.slice(0, t.headerRow).flat().map(text).join(' ');
  const titleDate = title.match(/(?:for\s+the\s+date|date)\s*:?\s*(\d{1,2}[-/.][A-Za-z0-9]{1,9}[-/.]\d{2,4}|\d{4}-\d{2}-\d{2})/i)?.[1];
  const period = title.match(PERIOD);
  const periodFrom = calendarDate(period?.[1]), periodTo = calendarDate(period?.[2]);
  // A single-day period (From = To) with no per-day "Date :" section still identifies its one date.
  const detectedDate = calendarDate(titleDate) || (periodFrom && periodFrom === periodTo ? periodFrom : '');
  let skippedTotals = 0;
  const notes: string[] = [];
  const rows: WeighmentWithLot[] = [];
  const totalRow = /^(grand\s+total|total\s+values|total)$/i;
  let sectionDate = detectedDate;
  t.rows.forEach((r, i) => {
    if (i <= t.headerRow) return;
    const marker = text(r[0]).match(DATE_MARKER);
    if (marker) { sectionDate = calendarDate(marker[1]) || sectionDate; return; }
    // The export sometimes prints a day's "Date : dd-Mon-yyyy" line fused into the day's first truck row, in some other
    // column (the register's first row did: the date sat in the Vehicle column of a shifted row). Read the date from it so
    // the whole day keeps its date, and do not reconcile the shifted row as a truck — its columns cannot be trusted.
    const fused = r.map(c => text(c).match(DATE_MARKER)).find(m => m && calendarDate(m[1]));
    if (fused) {
      sectionDate = calendarDate(fused[1]) || sectionDate;
      const cells = r.map(text).filter(Boolean);
      notes.push(`Weighment row ${i + 1} has "Date : ${fused[1].trim()}" fused into a truck line (${cells.filter(c => !DATE_MARKER.test(c)).slice(0, 5).join(' | ')}) — its columns are shifted, so it was not reconciled as a weighment. Add that truck manually if it is real.`);
      return;
    }
    const hasMovement = !!text(r[vi]) || (!!text(r[pi]) && !!text(r[mi]));
    if (!hasMovement || totalRow.test(text(r[pi])) || totalRow.test(text(r[ri])) || header(r[ri]) === header(h[ri])) return;
    if ([vi, pi, ri, mi].some(k => k >= 0 && TOTAL_LABEL.test(text(r[k])))) { skippedTotals++; return; }
    // Which of the two pass-weights is gross depends on direction (a purchase
    // is weighed loaded first, a sale empty first) — the heavier one is the
    // gross and the lighter the tare either way, and net = gross - tare.
    const w1 = gi >= 0 ? toNumber(r[gi]) : null, w2 = ti >= 0 ? toNumber(r[ti]) : null;
    const grossWeight = w1 != null && w2 != null ? Math.max(w1, w2) : null, tareWeight = w1 != null && w2 != null ? Math.min(w1, w2) : null;
    rows.push({ id: `${file}|${t.sheet}|${i + 1}`, ref: text(r[ri]), vehicle: text(r[vi]), party: text(r[pi]), material: text(r[mi]), lot: li >= 0 ? text(r[li]) : '', weight: toNumber(r[wi]), grossWeight, tareWeight, date: calendarDate(di >= 0 ? r[di] : '') || sectionDate, source: { file, sheet: t.sheet, row: i + 1 } });
  });
  if (!rows.length) throw new Error('Weighment: no physical entries found.');
  const wanted = calendarDate(selectedDate);
  // The date field is a picker for WHICH single day to pull out of a file
  // that spans many (this file's own "Date-Wise ... Register" covers a
  // whole month) — never a blind stamp overwriting the real per-section
  // dates just read above. A row with no detectable date at all still
  // falls back to the picked date, for a genuinely dateless single-day
  // export. Left blank, every row keeps its own real date and the file is
  // reconciled as ONE combined multi-day run — nothing downstream needs a
  // single shared date; every row already carries the date that drives its
  // own Recon ID, gate matching and persistence (see engine.ts/build.ts).
  const resolved = wanted ? rows.map(r => ({ ...r, date: r.date || wanted })) : rows;
  const inScope = wanted ? resolved.filter(r => r.date === wanted) : resolved;
  const fileDates = Array.from(new Set(resolved.map(r => r.date).filter(Boolean))).sort();
  if (wanted && !inScope.length) throw new Error(`No weighment rows found for ${wanted} in this file${fileDates.length ? ` (it covers ${fileDates[0]}${fileDates.length > 1 ? ` to ${fileDates[fileDates.length - 1]}` : ''})` : ''}.`);
  if (inScope.some(r => !r.date)) throw new Error(`Weighment date could not be detected${periodFrom && periodTo && periodFrom !== periodTo ? ` — the report covers ${periodFrom} to ${periodTo} but has no "Date :" day sections to tell the days apart` : ''}. Choose the reconciliation date and run again.`);
  const dates = Array.from(new Set(inScope.map(r => r.date))).sort();
  if (skippedTotals) notes.push(`Weighment report: ${skippedTotals} total line${skippedTotals === 1 ? '' : 's'} (Total Amount / Net Total) ignored — only real vehicle weighments are reconciled.`);
  return { rows: inScope, date: dates.length === 1 ? dates[0] : '', notes };
}
