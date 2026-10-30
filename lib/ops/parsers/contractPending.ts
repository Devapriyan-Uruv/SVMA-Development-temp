import * as XLSX from 'xlsx';
import { text } from '@/lib/reconciliation/normalize';
import { calendarDate } from '@/lib/reconciliation/parsers';
import { money } from '../normalize';
import { colIndex, findHeaderRow, sheetRows } from './shared';

// Real header (Contract List PendingSVMAAdmin...xlsx, sheet
// "DeOiledPendingContract"), confirmed live: Product Name | CONT.NO |
// CONT.DATE | PARTY NAME | PLACE | RATE/T | CON.QTY | DES.QTY | BAL.QTY |
// L.F | % | Q.CUT. Grouped by product name (a label-only row, carried
// forward like Stock Summary's category), each group ending in a
// blank-CONT.NO subtotal row. "As On Date" in the title confirms this is
// a SNAPSHOT report (same family as Purchase Order Pending / Settlement
// Pending) — versioned at the batch level, not deduped by business key.
// Confirmed live: CONT.NO values (e.g. "COP-SO/011/26-27") are the exact
// same contract numbers already in ops_sales_orders.so_no — this report
// is kept as its own independent snapshot on purpose (pending-contract
// rollup vs. dispatch transaction log are different semantics), not
// merged against Sale Order Details.

export type ParsedContractPendingRow = {
  productRaw: string; contNo: string; contDate: string; partyName: string; place: string;
  ratePerTon: number | null; conQty: number | null; desQty: number | null; balQty: number | null;
};

export function parseContractPending(book: XLSX.WorkBook): { asOfDate: string; rows: ParsedContractPendingRow[] } {
  let sheet = book.SheetNames.find(s => /pendingcontract/i.test(s)) || book.SheetNames[0];
  let rows = sheetRows(book, sheet);
  let hi = findHeaderRow(rows, [['CONT.NO', 'CONT NO'], ['PARTY NAME'], ['CON.QTY', 'CON QTY']]);
  if (hi < 0) for (const s of book.SheetNames) { const r = sheetRows(book, s); const h = findHeaderRow(r, [['CONT.NO', 'CONT NO'], ['CON.QTY', 'CON QTY']]); if (h >= 0) { sheet = s; rows = r; hi = h; break; } }
  if (hi < 0) throw new Error('Contract List Pending: could not locate the header row (CONT.NO / CON.QTY).');
  const head = rows[hi];
  const idx = {
    product: colIndex(head, ['Product Name']), contNo: colIndex(head, ['CONT.NO', 'CONT NO']), contDate: colIndex(head, ['CONT.DATE', 'CONT DATE']),
    party: colIndex(head, ['PARTY NAME']), place: colIndex(head, ['PLACE']), rate: colIndex(head, ['RATE/T']),
    conQty: colIndex(head, ['CON.QTY', 'CON QTY']), desQty: colIndex(head, ['DES.QTY', 'DES QTY']), balQty: colIndex(head, ['BAL.QTY', 'BAL QTY']),
  };
  const titleText = text(rows.slice(0, 6).flat().find(c => /as\s*on\s*date/i.test(text(c))));
  const asOfMatch = titleText.match(/(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})/);
  const asOfDate = asOfMatch ? calendarDate(asOfMatch[1]) : '';

  const out: ParsedContractPendingRow[] = [];
  let productRaw = '';
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r];
    const contNo = text(row?.[idx.contNo]);
    if (!contNo) { const label = text(row?.[idx.product]); if (label) productRaw = label; continue; }
    out.push({
      productRaw, contNo, contDate: calendarDate(row[idx.contDate]), partyName: text(row[idx.party]), place: text(row[idx.place]),
      ratePerTon: money(row[idx.rate]), conQty: money(row[idx.conQty]), desQty: money(row[idx.desQty]), balQty: money(row[idx.balQty]),
    });
  }
  if (!out.length) throw new Error('Contract List Pending: no data rows found under the header.');
  return { asOfDate, rows: out };
}
