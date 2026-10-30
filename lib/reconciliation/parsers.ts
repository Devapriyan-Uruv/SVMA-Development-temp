import * as XLSX from 'xlsx';
import { text, toNumber } from './normalize';

// Alias-tolerant header lookup — synonym GROUPS, not sheet-position rules.
// These lists are the "known synonyms so far" seed; genuinely new synonyms
// that don't match any group fall through to SCHEMA_REVIEW_REQUIRED
// (see schema.ts) rather than silently misreading a column.
const header = (v: unknown) => text(v).toLowerCase().replace(/[^a-z0-9]/g, '');
const raw = (book: XLSX.WorkBook, sheet: string): unknown[][] => XLSX.utils.sheet_to_json(book.Sheets[sheet], { header: 1, raw: true, defval: null });
function colIndex(row: unknown[], aliases: string[]): number { return row.findIndex(cell => aliases.map(header).includes(header(cell))); }

export function calendarDate(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  const s = text(value);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
  const dm = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  const named = s.match(/^(\d{1,2})[- /]([A-Za-z]{3,9})[- /](\d{2,4})$/);
  let y = 0, m = 0, d = 0;
  if (iso) { y = +iso[1]; m = +iso[2]; d = +iso[3]; }
  else if (dm) { d = +dm[1]; m = +dm[2]; y = +dm[3]; }
  else if (named) { d = +named[1]; m = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'].indexOf(named[2].slice(0, 3).toUpperCase()) + 1; y = +named[3]; }
  else return '';
  if (y < 100) y += 2000;
  const check = new Date(Date.UTC(y, m - 1, d));
  return check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : '';
}

export type Source = { file: string; sheet: string; row: number };
export type Weighment = { id: string; ref: string; vehicle: string; party: string; material: string; weight: number | null; date: string; source: Source };
export type Gate = { id: string; gp: string; vehicle: string; party: string; material: string; order: string; invoice: string; date: string; direction: 'IN' | 'OUT'; source: Source };

const VEHICLES = ['Vehilce No', 'Vehicle No', 'Vehicle Number', 'Lorry No', 'Truck No'];
const REFS = ['Serial No', 'Weigh Bridge Ref No', 'Weighment No', 'Weighment Ref', 'Ticket No'];
const NET = ['Net Weight', 'NetWeight', 'Net Wt', 'Net Weight (kg)', 'Net Weight (Kgs)', 'Net'];

export type FoundTable = { sheet: string; rows: unknown[][]; headerRow: number; headers: unknown[] };
export function findTable(book: XLSX.WorkBook, groups: string[][]): FoundTable | null {
  for (const sheet of book.SheetNames) {
    const rows = raw(book, sheet);
    const hi = rows.slice(0, 60).findIndex(row => groups.every(aliases => colIndex(row, aliases) >= 0));
    if (hi >= 0) return { sheet, rows, headerRow: hi, headers: rows[hi] };
  }
  return null;
}

export function parseWeighmentUpload(book: XLSX.WorkBook, file: string, selectedDate = ''): { rows: Weighment[]; date: string } {
  const t = findTable(book, [VEHICLES, REFS, ['Material', 'Material Name'], ['Party Name', 'Party', 'Supplier Name']]);
  if (!t) throw new Error('SCHEMA_REVIEW_REQUIRED: Weighment Register — required columns (Vehicle No, Serial No, Material, Party Name) were not found in any sheet.');
  const h = t.headers, vi = colIndex(h, VEHICLES), ri = colIndex(h, REFS), pi = colIndex(h, ['Party Name', 'Party', 'Supplier Name']), mi = colIndex(h, ['Material', 'Material Name']), wi = colIndex(h, NET), di = colIndex(h, ['Date', 'Weighment Date']);
  if (wi < 0) throw new Error('SCHEMA_REVIEW_REQUIRED: Weighment Register — Net Weight column is required.');
  const title = t.rows.slice(0, t.headerRow).flat().map(text).join(' ');
  const titleDate = title.match(/(?:for\s+the\s+date|date)\s*:?\s*(\d{1,2}[-/.][A-Za-z0-9]{1,9}[-/.]\d{2,4}|\d{4}-\d{2}-\d{2})/i)?.[1];
  const detectedDate = calendarDate(titleDate);
  if (selectedDate && !calendarDate(selectedDate)) throw new Error('Choose a valid reconciliation date.');
  const rows: Weighment[] = [];
  const totalRow = /^(grand\s+total|total\s+values|total)$/i;
  t.rows.forEach((r, i) => {
    const hasMovement = !!text(r[vi]) || (!!text(r[pi]) && !!text(r[mi]));
    if (i <= t.headerRow || !hasMovement || totalRow.test(text(r[pi])) || totalRow.test(text(r[ri])) || header(r[ri]) === header(h[ri])) return;
    rows.push({ id: `${file}|${t.sheet}|${i + 1}`, ref: text(r[ri]), vehicle: text(r[vi]), party: text(r[pi]), material: text(r[mi]), weight: toNumber(r[wi]), date: calendarDate(selectedDate) || calendarDate(di >= 0 ? r[di] : '') || detectedDate, source: { file, sheet: t.sheet, row: i + 1 } });
  });
  if (!rows.length) throw new Error('Weighment: no physical entries found.');
  if (rows.some(r => !r.date)) throw new Error('Weighment date could not be detected. Choose the reconciliation date and run again.');
  const dates = Array.from(new Set(rows.map(r => r.date)));
  if (dates.length !== 1) throw new Error('This report contains multiple weighment dates. Upload one operational day at a time.');
  return { rows, date: dates[0] };
}

export function parseGateUpload(book: XLSX.WorkBook, file: string, direction: 'IN' | 'OUT'): Gate[] {
  const parties = direction === 'IN' ? ['Supplier Name', 'Vendor Name'] : ['Customer Name', 'Party Name'];
  const materials = direction === 'IN' ? ['Material Name', 'Material'] : ['Products Name', 'Product Name', 'Material Name', 'Material'];
  const t = findTable(book, [VEHICLES, ['GatePass No', 'Gate Pass No', 'Gate Entry No'], parties, materials]);
  if (!t) throw new Error(`SCHEMA_REVIEW_REQUIRED: Gate ${direction} — required columns were not found in any sheet.`);
  const h = t.headers, vi = colIndex(h, VEHICLES), gi = colIndex(h, ['GatePass No', 'Gate Pass No', 'Gate Entry No']), pi = colIndex(h, parties), mi = colIndex(h, materials), di = colIndex(h, ['Date', 'Gate Date']),
    oi = colIndex(h, direction === 'IN' ? ['Purchase Order No', 'PO No'] : ['Supplier Order No', 'Sales Order No', 'SO No']), ii = colIndex(h, ['Invoice Number', 'Invoice No']);
  return t.rows.flatMap((r, i) => i <= t.headerRow || !text(r[gi]) || !text(r[vi]) || header(r[gi]) === header(h[gi])
    ? []
    : [{ id: `${file}|${t.sheet}|${i + 1}`, gp: text(r[gi]), vehicle: text(r[vi]), party: text(r[pi]), material: text(r[mi]), order: text(r[oi]), invoice: text(r[ii]), date: calendarDate(r[di]), direction, source: { file, sheet: t.sheet, row: i + 1 } }]);
}

// --- Tally workbook: register-role-aware parsing -------------------------
// A Tally "Day Book" upload is rarely one homogeneous ledger — in the real
// sample data it is a workbook of: per-commodity Purchase/Sales "ERP
// Register" sheets (the actual commercial booking vouchers, cross-linked to
// Gate In/Out via a Voucher Ref./Order No column) PLUS a literal Day Book
// and bank/cash "marketing book" sheets (Payment/Receipt/Journal — financial
// settlement only, never proof of booking; spec section 20). Treating every
// sheet the same way, or requiring "Vch No." on every sheet, silently drops
// commodity registers that key off "Supplier Invoice No." instead (observed
// in the real Soya Bean purchase register). This parser keeps sheets apart
// by role so later matching can prefer booking vouchers over settlement rows.

// A voucher's DOCUMENT STAGE is independent of which sheet it lives on — the
// Day Book itself often carries "Purchase Order"/"Sales Order" typed rows
// (the order itself, entered as its own Tally voucher) alongside genuine
// Payment/Receipt/Journal settlement rows, and a dedicated commodity
// register's own rows are the actual accounting BOOKING. Confusing "the
// order was found" with "the booking was found" is exactly the kind of
// false-positive the spec warns against (§20), so this is tracked explicitly
// per voucher, not inferred once per sheet.
export type VoucherStage = 'BOOKING' | 'ORDER' | 'SUPPORTING' | 'UNKNOWN';
export type TallyVoucher = {
  id: string; sheet: string; sheetRole: 'purchase_register' | 'sales_register' | 'daybook' | 'other_register';
  stage: VoucherStage;
  // The commodity register's own printed title (e.g. "Sales - Dorb/Rb -
  // ERP"), used to tell one commodity's register apart from another —
  // needed because the workbook's own SHEET TAB name is not reliable (one
  // real register was tabbed literally "Sheet1"); this is read from the
  // title rows above the header, falling back to the tab name only when no
  // such title line exists.
  registerLabel: string;
  company: string; date: string; party: string; vchType: string; vchNo: string; vchNoSource: 'Voucher No.' | 'Supplier Invoice No.' | 'Vch No.';
  orderRef: string; supplierInvoice: string; quantity: number | null; narration: string;
  particulars: string[]; details: string[]; sources: Source[];
};

// Real Tally Day Books carry commodity-qualified voucher-type labels for
// genuine bookings too (e.g. "Purchase - Bran ERP", "Sales - DOC - ERP",
// "Sales Job Work"), not just the bare words "Purchase"/"Sales" — the
// dedicated per-commodity register sheets are drill-down views of the same
// data, not the only place a booking can be found. Order-stage and
// settlement-only types are checked first so they are never miscounted as a
// booking just because the label also contains "Purchase"/"Sales".
function classifyStage(sheetRole: TallyVoucher['sheetRole'], vchType: string): VoucherStage {
  const t = vchType.toLowerCase();
  if (/order/.test(t)) return 'ORDER';
  if (/payment|receipt|journal|contra/.test(t)) return 'SUPPORTING';
  if (sheetRole === 'purchase_register' || sheetRole === 'sales_register' || /purchase|sales/.test(t)) return 'BOOKING';
  return 'UNKNOWN';
}

const DATE_H = ['Date'], PARTICULARS_H = ['Particulars'];
const VCH_NO_H = ['Vch No.', 'Voucher No.'];
const ORDER_REF_H = ['Voucher Ref. No.', 'Voucher Ref No', 'Order No', 'Purchase Order No', 'Sales Order No'];
const SUPPLIER_INVOICE_H = ['Supplier Invoice No.', 'Invoice No.'];
const VCH_TYPE_H = ['Vch Type', 'Voucher Type'];
const QTY_H = ['Quantity', 'Qty'];
const NARRATION_H = ['Narration'];

function classifySheetRole(registerLabel: string, headers: unknown[]): TallyVoucher['sheetRole'] {
  const hasVchType = colIndex(headers, VCH_TYPE_H) >= 0;
  const hasDebitCredit = colIndex(headers, ['Debit', 'Debit Amount']) >= 0 && colIndex(headers, ['Credit', 'Credit Amount']) >= 0;
  if (/purchase/i.test(registerLabel)) return 'purchase_register';
  if (/sales/i.test(registerLabel)) return 'sales_register';
  if (hasVchType && hasDebitCredit) return 'daybook';
  return 'other_register';
}

export function parseTallyUpload(book: XLSX.WorkBook, file: string): { vouchers: TallyVoucher[]; rawVoucherCount: number; recognizedSheets: number } {
  const output: TallyVoucher[] = [];
  let recognized = 0;
  for (const sheet of book.SheetNames) {
    const rows = raw(book, sheet);
    const hi = rows.slice(0, 60).findIndex(r => colIndex(r, DATE_H) >= 0 && colIndex(r, PARTICULARS_H) >= 0);
    if (hi < 0) continue;
    recognized++;
    const h = rows[hi];
    const di = colIndex(h, DATE_H), pi = colIndex(h, PARTICULARS_H), vi = colIndex(h, VCH_NO_H), ti = colIndex(h, VCH_TYPE_H),
      oi = colIndex(h, ORDER_REF_H), sii = colIndex(h, SUPPLIER_INVOICE_H), qi = colIndex(h, QTY_H), ni = colIndex(h, NARRATION_H);
    const registerLabel = rows.slice(0, hi).flat().map(text).find(s => /register$/i.test(s))?.replace(/\s+register$/i, '') || sheet.replace(/\s+register$/i, '');
    const sheetRole = classifySheetRole(registerLabel, h);
    let company = text(rows.slice(0, hi).find(r => r.some(v => text(v)))?.find(v => text(v)));
    let current: TallyVoucher | null = null;
    for (let i = hi + 1; i < rows.length; i++) {
      const r = rows[i];
      const date = calendarDate(r[di]), party = text(r[pi]);
      const vchNoRaw = vi >= 0 ? text(r[vi]) : '';
      const invoiceRaw = sii >= 0 ? text(r[sii]) : '';
      if (header(r[di]) === 'date' && header(r[pi]) === 'particulars') { current = null; continue; }
      if (!party && !vchNoRaw && /\b(?:PVT|PRIVATE|LIMITED|LTD)\b/i.test(text(r[di])) && !date) { company = text(r[di]); current = null; continue; }
      if (/^grand\s*total$/i.test(party)) { current = null; continue; }
      const vchNo = vchNoRaw || (sheetRole !== 'daybook' ? invoiceRaw : '');
      const isParentRow = party && date && (vchNo || sheetRole !== 'daybook') && (ti < 0 || text(r[ti]) || sheetRole !== 'daybook');
      if (isParentRow && vchNo) {
        const vchType = ti >= 0 ? text(r[ti]) : (sheetRole === 'purchase_register' ? 'Purchase' : sheetRole === 'sales_register' ? 'Sales' : '');
        current = {
          id: '', sheet, sheetRole, stage: classifyStage(sheetRole, vchType), registerLabel, company, date, party,
          vchType, vchNo, vchNoSource: vchNoRaw ? 'Voucher No.' : 'Supplier Invoice No.',
          orderRef: oi >= 0 ? text(r[oi]) : '', supplierInvoice: invoiceRaw, quantity: qi >= 0 ? toNumber(r[qi]) : null,
          narration: ni >= 0 ? text(r[ni]) : '', particulars: [party], details: ni >= 0 && text(r[ni]) ? [text(r[ni])] : [], sources: [{ file, sheet, row: i + 1 }],
        };
        output.push(current);
      } else if (current && sheetRole === 'daybook' && party) {
        if (!/^(New Ref|Agst Ref|On Account)$/i.test(party)) current.particulars.push(party);
        current.details.push(r.filter(v => text(v)).map(text).join(' | '));
      }
    }
  }
  if (!recognized) throw new Error('SCHEMA_REVIEW_REQUIRED: Tally — no sheet with Date and Particulars headers was found.');
  const map = new Map<string, TallyVoucher>();
  for (const v of output) {
    const key = [v.sheet, v.company, v.date, v.vchType, v.vchNo, v.party].map(s => text(s).toUpperCase()).join('|');
    const existing = map.get(key);
    if (existing) {
      existing.sources.push(...v.sources);
      existing.details = Array.from(new Set([...existing.details, ...v.details]));
      existing.particulars = Array.from(new Set([...existing.particulars, ...v.particulars]));
      existing.orderRef ||= v.orderRef; existing.supplierInvoice ||= v.supplierInvoice; existing.quantity ??= v.quantity;
    } else map.set(key, { ...v, id: key });
  }
  return { vouchers: [...map.values()], rawVoucherCount: output.length, recognizedSheets: recognized };
}
