import * as XLSX from 'xlsx';
import { text } from '@/lib/reconciliation/normalize';
import { calendarDate } from '@/lib/reconciliation/parsers';
import { isBlank, money, rowFingerprint } from '../normalize';
import { colIndex, sheetRows } from './shared';

// Real header (ProductionReport.xlsx, sheet "BatchFillingShiftWise") spans
// THREE rows:
//   row P (product group, sparse — Excel merged cells leave every column
//          but the first of each group blank; must be forward-filled):
//          | | | | | | | DE OILED RICE BRAN Normal (PLASTIC) | | DRY WAX | RICE BRAN OIL | | | SOYA BARI - 10MM | ...
//   row K (packing/sub-type under each product):
//          | | | | | | | Bulk | Plastic | Bulk | P I | | P II | Bags | ...
//   row L (field labels — blank under the product/packing quantity block,
//          re-labeled for the trailing quality columns):
//          Reference No | | | | Date | Shift | Time | | ... | OIL | MOI | SS | FIBER | PROTIN | FFA | IV | TASH | PDI | UREA | Production % | Description
// The quantity block runs from the column after "Time" up to (not including)
// "OIL" — the first trailing quality label.

const QUALITY_LABELS = ['OIL', 'MOI', 'SS', 'FIBER', 'PROTIN', 'FFA', 'IV', 'TASH', 'PDI', 'UREA', 'Production %', 'Description'];

export type ParsedProductionRow = {
  referenceNo: string; reportDate: string; shift: string; timeSlot: string;
  productRaw: string; packing: string; quantity: number;
  oil: number | null; moi: number | null; ssPct: number | null; fiber: number | null; protein: number | null;
  ffa: number | null; iv: number | null; tash: number | null; pdi: number | null; urea: number | null;
  productionPct: number | null; description: string; rowFingerprint: string;
};

export function parseProductionReport(book: XLSX.WorkBook): ParsedProductionRow[] {
  let sheet = book.SheetNames.find(s => /batchfilling|production/i.test(s)) || book.SheetNames[0];
  let rows = sheetRows(book, sheet);
  let labelRowIdx = rows.slice(0, 20).findIndex(r => colIndex(r, ['Reference No']) >= 0 && colIndex(r, ['Date']) >= 0 && colIndex(r, ['Shift']) >= 0);
  if (labelRowIdx < 2) for (const s of book.SheetNames) { const r = sheetRows(book, s); const h = r.slice(0, 20).findIndex(row => colIndex(row, ['Reference No']) >= 0 && colIndex(row, ['Shift']) >= 0); if (h >= 2) { sheet = s; rows = r; labelRowIdx = h; break; } }
  if (labelRowIdx < 2) throw new Error('ProductionReport: could not locate the Reference No / Date / Shift label row.');

  const productRow = rows[labelRowIdx - 2] || [];
  const packingRow = rows[labelRowIdx - 1] || [];
  const labelRow = rows[labelRowIdx];

  const refIdx = colIndex(labelRow, ['Reference No']);
  const dateIdx = colIndex(labelRow, ['Date']);
  const shiftIdx = colIndex(labelRow, ['Shift']);
  const timeIdx = colIndex(labelRow, ['Time']);
  const qualityStartIdx = colIndex(labelRow, ['OIL']);
  if ([refIdx, dateIdx, shiftIdx, timeIdx, qualityStartIdx].some(i => i < 0)) throw new Error('ProductionReport: header row is missing an expected column (Reference No/Date/Shift/Time/OIL).');

  // Forward-fill the sparse product-group row across merged-cell blanks.
  const filledProduct: string[] = [];
  let last = '';
  for (let i = 0; i < labelRow.length; i++) {
    const cell = text(productRow[i]);
    if (cell) last = cell;
    filledProduct[i] = last;
  }

  const productBlockStart = timeIdx + 1;
  const productBlockEnd = qualityStartIdx - 1;
  const columnKeys: { product: string; packing: string }[] = [];
  for (let i = productBlockStart; i <= productBlockEnd; i++) columnKeys[i] = { product: filledProduct[i], packing: text(packingRow[i]) };

  const qIdx = {
    oil: colIndex(labelRow, ['OIL']), moi: colIndex(labelRow, ['MOI']), ss: colIndex(labelRow, ['SS']),
    fiber: colIndex(labelRow, ['FIBER']), protein: colIndex(labelRow, ['PROTIN', 'PROTEIN']), ffa: colIndex(labelRow, ['FFA']),
    iv: colIndex(labelRow, ['IV']), tash: colIndex(labelRow, ['TASH']), pdi: colIndex(labelRow, ['PDI']), urea: colIndex(labelRow, ['UREA']),
    productionPct: colIndex(labelRow, ['Production %']), description: colIndex(labelRow, ['Description']),
  };

  const out: ParsedProductionRow[] = [];
  for (let r = labelRowIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    const referenceNo = text(row?.[refIdx]);
    if (!referenceNo || /^total$/i.test(referenceNo)) continue;
    const reportDate = calendarDate(row[dateIdx]);
    if (!reportDate) continue;
    const shift = text(row[shiftIdx]), timeSlot = text(row[timeIdx]);
    const quality = {
      oil: money(row[qIdx.oil]), moi: money(row[qIdx.moi]), ssPct: money(row[qIdx.ss]), fiber: money(row[qIdx.fiber]),
      protein: money(row[qIdx.protein]), ffa: money(row[qIdx.ffa]), iv: money(row[qIdx.iv]), tash: money(row[qIdx.tash]),
      pdi: money(row[qIdx.pdi]), urea: money(row[qIdx.urea]), productionPct: money(row[qIdx.productionPct]), description: text(row[qIdx.description]),
    };
    for (let i = productBlockStart; i <= productBlockEnd; i++) {
      if (isBlank(row[i])) continue;
      const quantity = money(row[i]);
      if (quantity === null || quantity === 0) continue; // untouched product this shift
      const { product, packing } = columnKeys[i];
      if (!product) continue;
      out.push({
        referenceNo, reportDate, shift, timeSlot, productRaw: product, packing, quantity, ...quality,
        rowFingerprint: rowFingerprint({ referenceNo, product, packing, quantity }),
      });
    }
  }
  if (!out.length) throw new Error('ProductionReport: no non-zero production quantities found under the header.');
  return out;
}
