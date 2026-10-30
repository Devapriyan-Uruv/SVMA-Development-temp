import * as XLSX from 'xlsx';
import { text } from '@/lib/reconciliation/normalize';
import { calendarDate } from '@/lib/reconciliation/parsers';
import { money, rowFingerprint } from '../normalize';
import { colIndex, findHeaderRow, sheetRows } from './shared';

// Real header (Feeding Details.xlsx, sheet "DateWiseIssueDetails"):
// Reference No | Date | Shift | Time | Lot No | Product Name | Weight |
// Jute Bag | Plastic Bag | SS | FIBER | MOI | MOI REC | LAB OIL |
// LAB Oil REC % | ReportedOIL | R.Oil REC % | Amount | Feeding.%

export type ParsedFeedingRow = {
  referenceNo: string; reportDate: string; shift: string; timeSlot: string; lotNo: string;
  productRaw: string; weightMt: number | null; juteBag: number | null; plasticBag: number | null;
  ss: number | null; fiber: number | null; moi: number | null; moiRec: number | null;
  labOil: number | null; labOilRecPct: number | null; reportedOil: number | null; rOilRecPct: number | null;
  amount: number | null; feedingPct: number | null; rowFingerprint: string;
};

export function parseFeedingDetails(book: XLSX.WorkBook): ParsedFeedingRow[] {
  let sheet = book.SheetNames.find(s => /issue.*detail/i.test(s)) || book.SheetNames[0];
  let rows = sheetRows(book, sheet);
  let hi = findHeaderRow(rows, [['Reference No'], ['Date'], ['Shift'], ['Lot No'], ['Product Name']]);
  if (hi < 0) for (const s of book.SheetNames) { const r = sheetRows(book, s); const h = findHeaderRow(r, [['Reference No'], ['Date'], ['Shift']]); if (h >= 0) { sheet = s; rows = r; hi = h; break; } }
  if (hi < 0) throw new Error('Feeding Details: could not locate the header row (Reference No / Date / Shift).');
  const head = rows[hi];
  const idx = {
    ref: colIndex(head, ['Reference No']), date: colIndex(head, ['Date']), shift: colIndex(head, ['Shift']), time: colIndex(head, ['Time']),
    lot: colIndex(head, ['Lot No']), product: colIndex(head, ['Product Name']), weight: colIndex(head, ['Weight']),
    jute: colIndex(head, ['Jute Bag']), plastic: colIndex(head, ['Plastic Bag']), ss: colIndex(head, ['SS']),
    fiber: colIndex(head, ['FIBER']), moi: colIndex(head, ['MOI']), moiRec: colIndex(head, ['MOI REC']),
    labOil: colIndex(head, ['LAB OIL']), labOilRecPct: colIndex(head, ['LAB Oil REC %']),
    reportedOil: colIndex(head, ['ReportedOIL', 'Reported OIL']), rOilRecPct: colIndex(head, ['R.Oil REC %', 'R Oil REC %']),
    amount: colIndex(head, ['Amount']), feedingPct: colIndex(head, ['Feeding.%', 'Feeding %']),
  };
  const out: ParsedFeedingRow[] = [];
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r];
    const referenceNo = text(row?.[idx.ref]);
    if (!referenceNo) continue;
    const reportDate = calendarDate(row[idx.date]);
    if (!reportDate) continue;
    const parsed: ParsedFeedingRow = {
      referenceNo, reportDate, shift: text(row[idx.shift]), timeSlot: text(row[idx.time]), lotNo: text(row[idx.lot]),
      productRaw: text(row[idx.product]), weightMt: money(row[idx.weight]), juteBag: money(row[idx.jute]), plasticBag: money(row[idx.plastic]),
      ss: money(row[idx.ss]), fiber: money(row[idx.fiber]), moi: money(row[idx.moi]), moiRec: money(row[idx.moiRec]),
      labOil: money(row[idx.labOil]), labOilRecPct: money(row[idx.labOilRecPct]), reportedOil: money(row[idx.reportedOil]),
      rOilRecPct: money(row[idx.rOilRecPct]), amount: money(row[idx.amount]), feedingPct: money(row[idx.feedingPct]),
      rowFingerprint: '',
    };
    parsed.rowFingerprint = rowFingerprint({ referenceNo, lotNo: parsed.lotNo, productRaw: parsed.productRaw, weightMt: parsed.weightMt, amount: parsed.amount });
    out.push(parsed);
  }
  if (!out.length) throw new Error('Feeding Details: no data rows found under the header.');
  return out;
}
