import * as XLSX from 'xlsx';
import { text } from '@/lib/reconciliation/normalize';
import { calendarDate } from '@/lib/reconciliation/parsers';
import { money } from '../normalize';
import { colIndex, findHeaderRow, sheetRows } from './shared';

// Real header (BrokerageSVMAAdmin...xlsx, sheet "Brokerage"), confirmed
// live: CON NO | DATE | PARTY NAME | GRADE | CALU TYPE | CON QTY |
// DES/REC QTY | PER.TON | JUTE | PLASTIC | TOTAL. Rows are grouped under a
// broker-name label row (just the broker's name in the first column, e.g.
// "AATHI") — confirmed the header row REPEATS after every broker-name row,
// unlike Stock Summary's single-header-then-category-rows shape. Confirmed
// this file only ever has a "Sales" block, no "Purchase" block. con_no
// values are the same contract numbers already in ops_sales_orders.so_no
// (confirmed live) — this is a genuine enrichment (broker + fee + bag
// counts), not a duplicate; ops_sales_orders has no broker columns.

export type ParsedBrokerageRow = {
  conNo: string; conDate: string; brokerName: string; partyName: string; grade: string;
  calcType: string; conQty: number | null; desRecQty: number | null; perTon: number | null;
  juteBag: number | null; plasticBag: number | null; total: number | null;
};

export function parseBrokerage(book: XLSX.WorkBook): ParsedBrokerageRow[] {
  let sheet = book.SheetNames.find(s => /brokerage/i.test(s)) || book.SheetNames[0];
  let rows = sheetRows(book, sheet);
  let hi = findHeaderRow(rows, [['CON NO'], ['PARTY NAME'], ['CON QTY']]);
  if (hi < 0) for (const s of book.SheetNames) { const r = sheetRows(book, s); const h = findHeaderRow(r, [['CON NO'], ['CON QTY']]); if (h >= 0) { sheet = s; rows = r; hi = h; break; } }
  if (hi < 0) throw new Error('Brokerage: could not locate the header row (CON NO / CON QTY).');
  const head = rows[hi];
  const idx = {
    conNo: colIndex(head, ['CON NO']), date: colIndex(head, ['DATE']), party: colIndex(head, ['PARTY NAME']), grade: colIndex(head, ['GRADE']),
    calcType: colIndex(head, ['CALU TYPE']), conQty: colIndex(head, ['CON QTY']), desRec: colIndex(head, ['DES/REC QTY']), perTon: colIndex(head, ['PER.TON', 'PER TON']),
    jute: colIndex(head, ['JUTE']), plastic: colIndex(head, ['PLASTIC']), total: colIndex(head, ['TOTAL']),
  };

  const out: ParsedBrokerageRow[] = [];
  let brokerName = '';
  // Starts from row 0, not hi+1: the first broker-name row ("AATHI") sits
  // BEFORE the first header row (confirmed live — a "Sales" section label
  // then the broker name both precede the first CON NO header) — starting
  // after hi silently lost that first broker's name, leaving its rows
  // blank. The "Sales"/"Purchase" section label itself is skipped
  // explicitly so it never gets mistaken for a broker name even
  // momentarily, though it's confirmed this file only ever has a Sales
  // block.
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const first = text(row?.[idx.conNo]);
    if (!first) continue;
    if (first.toUpperCase() === 'CON NO') continue; // the header repeats per broker — skip re-matches
    if (/^(sales|purchase)$/i.test(first)) continue; // a section label, not a broker name
    const date = text(row[idx.date]);
    if (!date) { brokerName = first; continue; } // a broker-name label row, not data
    out.push({
      conNo: first, conDate: calendarDate(row[idx.date]), brokerName, partyName: text(row[idx.party]), grade: text(row[idx.grade]),
      calcType: text(row[idx.calcType]), conQty: money(row[idx.conQty]), desRecQty: money(row[idx.desRec]), perTon: money(row[idx.perTon]),
      juteBag: money(row[idx.jute]), plasticBag: money(row[idx.plastic]), total: money(row[idx.total]),
    });
  }
  if (!out.length) throw new Error('Brokerage: no data rows found under the header.');
  return out;
}
