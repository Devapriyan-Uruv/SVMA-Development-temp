import * as XLSX from 'xlsx';
import { text } from '@/lib/reconciliation/normalize';
import { calendarDate } from '@/lib/reconciliation/parsers';
import { money } from '../normalize';
import { colIndex, findHeaderRow, header, sheetRows } from './shared';

// Real header (Inward QC Report.xlsx, sheet "InwardQCRep") — THREE repeated
// random-sample blocks per lot (one row = one lot's 3 samples), each block
// Code/Calcium/FFA/FIBER/IV/MOI/OIL/PROTEIN/SS. Confirmed irregular in the
// real file: the FIRST block has an extra unlabeled spacer column between
// Calcium and FFA that the 2nd/3rd blocks don't — so blocks are located by
// searching for each "Code" column and resolving the rest of that block's
// fields BY NAME within that block's own span, never by a fixed offset.
// S.No | Reference No | Lot Number | Date | Product Name | [Code|Calcium|(FFA..SS)] x3

export type ParsedQcSampleRow = {
  referenceNo: string; lotNo: string; reportDate: string; productRaw: string;
  sampleCode: string; calcium: number | null; ffa: number | null; fiber: number | null; iv: number | null; moi: number | null; oil: number | null; protein: number | null; ss: number | null;
};

export function parseInwardQc(book: XLSX.WorkBook): ParsedQcSampleRow[] {
  let sheet = book.SheetNames.find(s => /inwardqc/i.test(s)) || book.SheetNames[0];
  let rows = sheetRows(book, sheet);
  let hi = findHeaderRow(rows, [['Reference No'], ['Lot Number'], ['Product Name']]);
  if (hi < 0) for (const s of book.SheetNames) { const r = sheetRows(book, s); const h = findHeaderRow(r, [['Reference No'], ['Lot Number']]); if (h >= 0) { sheet = s; rows = r; hi = h; break; } }
  if (hi < 0) throw new Error('Inward QC Report: could not locate the header row (Reference No / Lot Number).');
  const head = rows[hi];

  const refIdx = colIndex(head, ['Reference No']);
  const lotIdx = colIndex(head, ['Lot Number']);
  const dateIdx = colIndex(head, ['Date']);
  const productIdx = colIndex(head, ['Product Name']);
  if ([refIdx, lotIdx, dateIdx, productIdx].some(i => i < 0)) throw new Error('Inward QC Report: header is missing an expected column (Reference No/Lot Number/Date/Product Name).');

  const codeCols: number[] = [];
  for (let i = 0; i < head.length; i++) if (header(head[i]) === 'code') codeCols.push(i);
  if (!codeCols.length) throw new Error('Inward QC Report: no sample "Code" columns found.');

  const blocks = codeCols.map((start, i) => {
    const end = i + 1 < codeCols.length ? codeCols[i + 1] : head.length;
    const slice = head.slice(start, end);
    const sub = (aliases: string[]) => { const j = colIndex(slice, aliases); return j < 0 ? -1 : start + j; };
    return { codeIdx: start, calciumIdx: sub(['Calcium']), ffaIdx: sub(['FFA']), fiberIdx: sub(['FIBER']), ivIdx: sub(['IV']), moiIdx: sub(['MOI']), oilIdx: sub(['OIL']), proteinIdx: sub(['PROTEIN']), ssIdx: sub(['SS']) };
  });

  const out: ParsedQcSampleRow[] = [];
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r];
    const referenceNo = text(row?.[refIdx]);
    const lotNo = text(row?.[lotIdx]);
    if (!referenceNo || !lotNo) continue;
    const reportDate = calendarDate(row[dateIdx]);
    const productRaw = text(row[productIdx]);
    for (const b of blocks) {
      const sampleCode = text(row[b.codeIdx]);
      if (!sampleCode) continue;
      out.push({
        referenceNo, lotNo, reportDate, productRaw, sampleCode,
        calcium: b.calciumIdx >= 0 ? money(row[b.calciumIdx]) : null, ffa: b.ffaIdx >= 0 ? money(row[b.ffaIdx]) : null, fiber: b.fiberIdx >= 0 ? money(row[b.fiberIdx]) : null,
        iv: b.ivIdx >= 0 ? money(row[b.ivIdx]) : null, moi: b.moiIdx >= 0 ? money(row[b.moiIdx]) : null, oil: b.oilIdx >= 0 ? money(row[b.oilIdx]) : null,
        protein: b.proteinIdx >= 0 ? money(row[b.proteinIdx]) : null, ss: b.ssIdx >= 0 ? money(row[b.ssIdx]) : null,
      });
    }
  }
  if (!out.length) throw new Error('Inward QC Report: no sample rows found under the header.');
  return out;
}
