import ExcelJS from 'exceljs';
import { PassThrough } from 'stream';
import { COLUMNS, columnsFor, SECTION_COLORS, type Col, type MasterRow, type OneReconResult, type ReconStatus } from './master';

// Main sheet + filtered sheets are built from the SAME rows by the same
// function — a filtered sheet is a status filter, never a re-reconciliation.

const FILTER_SHEETS: ReconStatus[] = ['QC MISSING', 'ERP MISSING', 'TALLY MISSING', 'SETTLEMENT PENDING', 'AMOUNT MISMATCH', 'QUANTITY MISMATCH', 'OIL MISMATCH', 'REVIEW REQUIRED'];
const FMT: Record<Col['fmt'], string | undefined> = {
  text: undefined, date: 'dd-mmm-yyyy', money: '"₹"#,##0.00;[Red]-"₹"#,##0.00', qty: '#,##0.000', pct: '0.00"%"', int: '#,##0',
};
const thin = { style: 'thin' as const, color: { argb: 'FFD0D5DD' } };
const STATUS_FILL: Record<string, string> = { 'FULLY MATCHED': 'FFDCFCE7', 'PARTIAL MATCH': 'FFFEF9C3', 'REVIEW REQUIRED': 'FFFFEDD5', 'NOT MATCHED': 'FFFEE2E2' };

function cellValue(col: Col, v: string | number | undefined): string | number | Date {
  if (col.blank) return '';
  if (col.allowEmpty && (v === undefined || v === null || v === '')) return '';
  if (v === undefined || v === null || v === '') return 'Not Found';
  if (col.fmt === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T00:00:00Z`);
  return v;
}

// The workbook is written with ExcelJS's STREAMING writer. The ordinary in-memory writer keeps every cell
// object alive until the end — a month of reconciliation (about 1,500 rows x 12 sheets plus the audit trail)
// needed ~520 MB, which is more than the server has, so the export died and the page only saw an empty reply.
// Rows are committed as they are written, so memory stays flat; the cells, formats and colours are the same.
type Sheet = ExcelJS.Worksheet;
type Book = ExcelJS.stream.xlsx.WorkbookWriter;

function addMasterSheet(wb: Book, name: string, rows: MasterRow[], cols: Col[] = COLUMNS, view: (r: MasterRow) => Record<string, string | number> = r => r.v) {
  const FROZEN = cols.reduce((n, c, i) => (c.freeze ? i + 1 : n), 0);
  const ws: Sheet = wb.addWorksheet(name, { views: [{ state: 'frozen', xSplit: FROZEN, ySplit: 2 }] });
  ws.columns = cols.map(c => ({ width: c.width }));
  // Row 1: section band (merged per contiguous section). Row 2: headers.
  const band = ws.getRow(1);
  let start = 0;
  for (let i = 1; i <= cols.length; i++) {
    if (i === cols.length || cols[i].section !== cols[start].section) {
      if (i - 1 > start) ws.mergeCells(1, start + 1, 1, i);
      const cell = band.getCell(start + 1); cell.value = cols[start].section;
      for (let k = start; k < i; k++) band.getCell(k + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${SECTION_COLORS[cols[start].section]}` } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.alignment = { horizontal: 'center' };
      start = i;
    }
  }
  band.commit();
  const head = ws.getRow(2);
  cols.forEach((c, i) => {
    const cell = head.getCell(i + 1); cell.value = c.label;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${SECTION_COLORS[c.section]}` } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; cell.border = { top: thin, bottom: thin, left: thin, right: thin };
  });
  head.height = 32;
  head.commit();
  // Not every layout carries a status column (the Sales sheet follows the client's own format).
  const si = cols.findIndex(c => (c.src ?? c.key) === 'reconStatus');
  for (const r of rows) {
    const rv = view(r);
    const row = ws.addRow(cols.map(c => cellValue(c, rv[c.src ?? c.key])));
    row.eachCell({ includeEmpty: true }, (cell, n) => {
      const c = cols[n - 1];
      const f = FMT[c.fmt]; const isNum = typeof cell.value === 'number' || cell.value instanceof Date;
      if (f && isNum) cell.numFmt = f;
      cell.alignment = { vertical: 'top', horizontal: isNum ? 'right' : 'left', wrapText: (c.src ?? c.key) === 'aiComment' || (c.src ?? c.key) === 'exceptions' };
      cell.border = { top: thin, bottom: thin, left: thin, right: thin };
      if (typeof cell.value === 'string' && (cell.value === 'Not Found' || cell.value === 'N/A')) cell.font = { color: { argb: cell.value === 'Not Found' ? 'FFB42318' : 'FF667085' }, italic: true };
    });
    if (si >= 0) { const st = row.getCell(si + 1); st.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STATUS_FILL[r.primaryStatus] || 'FFFEE2E2' } }; st.font = { bold: true }; }
    row.commit();
  }
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: cols.length } };
  return Promise.resolve(ws.commit());
}

function addTable(wb: Book, name: string, headers: string[], widths: number[], rows: (string | number)[][]) {
  const ws: Sheet = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = widths.map(w => ({ width: w }));
  const h = ws.addRow(headers); h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  h.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } }; c.alignment = { vertical: 'top', wrapText: true }; });
  h.commit();
  for (const r of rows) { const row = ws.addRow(r); row.eachCell(c => { c.alignment = { vertical: 'top', wrapText: true }; }); row.commit(); }
  if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  return Promise.resolve(ws.commit());
}

export async function buildOneReconWorkbook(result: OneReconResult): Promise<Buffer> {
  const out = new PassThrough(); const chunks: Buffer[] = [];
  out.on('data', (c: Buffer) => chunks.push(c));
  const finished = new Promise<void>((resolve, reject) => { out.on('end', resolve); out.on('error', reject); });
  const wb: Book = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true, useSharedStrings: true });
  wb.creator = 'SVMA Intelligence'; wb.created = new Date();
  await addMasterSheet(wb, 'ONE RECONCILIATION', result.rows);
  // Purchase split by the Credit/Debit Note's PurchaseType — same rows, each laid out to its own Finance template.
  await addMasterSheet(wb, 'DIRECT PURCHASE', result.rows.filter(r => r.transactionType === 'Direct Purchase'), columnsFor('Direct Purchase'));
  await addMasterSheet(wb, 'INDIRECT PURCHASE', result.rows.filter(r => r.transactionType === 'Indirect Purchase'), columnsFor('Indirect Purchase'));
  // Sales laid out to the client's "SALES - DEBTORS DETAILS" format.
  // Existing Sales rows first and unchanged; then sales to group companies (Inter/Job Work rows that carry an ERP sales invoice, shown here
  // as sales without changing the row anywhere else); then ERP sales invoices that have no weighment row.
  const salesRows = [...result.rows.filter(r => r.transactionType === 'Sales'), ...result.rows.filter(r => r.salesView), ...(result.salesNoWeighment || [])];
  await addMasterSheet(wb, 'SALES', salesRows, columnsFor('Sales'), r => (r.transactionType === 'Sales' ? r.v : r.salesView || r.v));
  for (const s of FILTER_SHEETS) await addMasterSheet(wb, s, result.rows.filter(r => r.statuses.includes(s)));
  // ERP receipts / Tally purchase bookings in the period with no weighment row (never counted in the sheets above).
  await addTable(wb, 'UNLINKED RECORDS', ['Source', 'Date', 'Reference', 'Lot', 'Party', 'Vehicle', 'Product', 'Quantity (MT)', 'Amount', 'Tally Voucher', 'ERP Receipt', 'Nearest Weighments (same vehicle, ±1 day)', 'Why it may be unlinked'], [14, 12, 22, 24, 30, 14, 24, 13, 14, 32, 22, 60, 80],
    (result.unlinked || []).map(u => [u.source, u.date, u.reference, u.lot, u.party, u.vehicle, u.product, u.quantityMt ?? '', u.amount ?? '', u.tallyVoucher, u.erpReceipt, u.nearestWeighments, u.reason]));
  await addTable(wb, 'REPORTS UNDERSTOOD', ['File', 'Detected Report Type', 'Confidence', 'How Identified', 'Sheet', 'Rows', 'Status', 'Note'], [34, 26, 11, 28, 20, 8, 14, 70],
    result.understanding.map(u => [u.file, u.label, Math.round(u.confidence * 100), u.method, u.sheet, u.rows, u.status, u.note]));
  await addTable(wb, 'DEFINITIONS', ['Run', 'Definition / Rule'], [24, 150], [
    ['Run ID', result.runId], ['Reconciliation Date', result.reconciliationDate], ['Total Transactions', result.summary.total],
    ...Object.entries(result.summary.byStatus).map(([k, v]) => [`Rows with status: ${k}`, v] as (string | number)[]),
    ...result.warnings.map(w => ['Warning', w]), ...result.definitions.map(d => ['Rule', d]),
  ]);
  await addTable(wb, 'AUDIT TRAIL', ['Recon ID', 'Run ID', 'Stage', 'Field', 'Raw Value', 'Normalized Value', 'Source', 'Source File', 'Sheet / Table', 'Row', 'Match Rule', 'Confidence %'], [20, 16, 16, 20, 30, 30, 14, 34, 22, 16, 60, 12],
    result.rows.flatMap(r => r.audit.map(a => [r.reconId, a.runId, a.stage, a.field, a.rawValue, a.normalizedValue, a.origin === 'upload' ? 'Uploaded file' : a.origin === 'operations_db' ? 'Operations DB' : 'Derived', a.sourceFile, a.sourceSheet, a.sourceRow, a.rule, Math.round(a.confidence * 100)])));
  await wb.commit();
  await finished;
  return Buffer.concat(chunks);
}
