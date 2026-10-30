import * as XLSX from 'xlsx';
import { text } from '@/lib/reconciliation/normalize';
import { calendarDate } from '@/lib/reconciliation/parsers';
import { money } from '../normalize';
import { colIndex, findHeaderRow, sheetRows } from './shared';

// Real header (InwardPaymentSVMAAdmin...xlsx, sheet "InwardPay"),
// confirmed live: ReferenceNo | PaymentDate | SupplierName | Location |
// BankName | Lotnumber/BillNo | Amount | Total Amount. A genuine
// parent/child row structure — confirmed live: ReferenceNo/PaymentDate/
// SupplierName/Location/BankName/TotalAmount populate only the FIRST row
// of a payment group ("Pay/0812/26-27"); every following row until the
// next non-blank ReferenceNo is a child line carrying only its own
// Lotnumber/BillNo + Amount. Carried forward onto each child row (same
// carry-forward idea as Stock Summary's category, extended to several
// fields) — the parent line itself is never emitted as its own row since
// it has no lot/bill reference to key on.

export type ParsedInwardPaymentRow = {
  referenceNo: string; paymentDate: string; supplierName: string; location: string; bankName: string;
  lotOrBillNo: string; amount: number | null; totalAmount: number | null;
};

export function parseInwardPayment(book: XLSX.WorkBook): ParsedInwardPaymentRow[] {
  let sheet = book.SheetNames.find(s => /inwardpay/i.test(s)) || book.SheetNames[0];
  let rows = sheetRows(book, sheet);
  let hi = findHeaderRow(rows, [['ReferenceNo'], ['SupplierName'], ['Lotnumber/BillNo', 'Lotnumber']]);
  if (hi < 0) for (const s of book.SheetNames) { const r = sheetRows(book, s); const h = findHeaderRow(r, [['ReferenceNo'], ['SupplierName']]); if (h >= 0) { sheet = s; rows = r; hi = h; break; } }
  if (hi < 0) throw new Error('Inward Payment: could not locate the header row (ReferenceNo / SupplierName).');
  const head = rows[hi];
  const idx = {
    ref: colIndex(head, ['ReferenceNo']), date: colIndex(head, ['PaymentDate']), supplier: colIndex(head, ['SupplierName']),
    location: colIndex(head, ['Location']), bank: colIndex(head, ['BankName']), lotOrBill: colIndex(head, ['Lotnumber/BillNo', 'Lotnumber']),
    amount: colIndex(head, ['Amount']), total: colIndex(head, ['Total Amount']),
  };
  if ([idx.ref, idx.lotOrBill].some(i => i < 0)) throw new Error('Inward Payment: header row is missing ReferenceNo or Lotnumber/BillNo.');

  const out: ParsedInwardPaymentRow[] = [];
  let referenceNo = '', paymentDate = '', supplierName = '', location = '', bankName = '', totalAmount: number | null = null;
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r];
    const ref = text(row?.[idx.ref]);
    if (ref) { referenceNo = ref; paymentDate = calendarDate(row[idx.date]); supplierName = text(row[idx.supplier]); location = text(row[idx.location]); bankName = text(row[idx.bank]); totalAmount = money(row[idx.total]); continue; }
    const lotOrBillNo = text(row?.[idx.lotOrBill]);
    if (!lotOrBillNo || !referenceNo) continue;
    out.push({ referenceNo, paymentDate, supplierName, location, bankName, lotOrBillNo, amount: money(row[idx.amount]), totalAmount });
  }
  if (!out.length) throw new Error('Inward Payment: no data rows found under the header.');
  return out;
}
