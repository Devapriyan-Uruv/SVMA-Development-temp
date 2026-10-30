import * as XLSX from 'xlsx';
import { text } from '@/lib/reconciliation/normalize';
import { calendarDate } from '@/lib/reconciliation/parsers';
import { money } from '../normalize';
import { colIndex, findHeaderRow, sheetRows } from './shared';

// Real header (ERP VIEW REPORT'S.xlsx, sheet "PurchaseRegisterLotWise"):
// PurchaseType | | PO.No | | RN.No | RN Date | Lot No | Supplier Name |
// Place | Vehicle No | Material Name | | Bill No | BillRate | BillQty |
// CGST | SGST | IGST | BillValue | Weight (MT) | Jute bag | Plastic Bag |
// Total Bag's | FreightAmt
// This is the receipt-note record that links a PO+lot to an actual bill —
// the last unbuilt stage of the Supply chain (PO -> Gate -> Weighment ->
// Receipt -> Lot -> QC -> Settlement). RN.No is the natural business key.

export type ParsedPurchaseReceiptRow = {
  rnNo: string; rnDate: string; purchaseType: string; poNo: string; lotNo: string;
  supplierName: string; place: string; vehicleNo: string; productRaw: string;
  billNo: string; billRate: number | null; billQty: number | null;
  cgst: number | null; sgst: number | null; igst: number | null; billValue: number | null;
  weight: number | null; juteBag: number | null; plasticBag: number | null; totalBags: number | null; freightAmt: number | null;
};

export function parsePurchaseReceipts(book: XLSX.WorkBook): ParsedPurchaseReceiptRow[] {
  let sheet = book.SheetNames.find(s => /purchaseregister/i.test(s)) || book.SheetNames[0];
  let rows = sheetRows(book, sheet);
  let hi = findHeaderRow(rows, [['RN.No', 'RN No'], ['Lot No'], ['Supplier Name']]);
  if (hi < 0) for (const s of book.SheetNames) { const r = sheetRows(book, s); const h = findHeaderRow(r, [['RN.No', 'RN No'], ['Lot No']]); if (h >= 0) { sheet = s; rows = r; hi = h; break; } }
  if (hi < 0) throw new Error("Purchase Register LotWise: could not locate the header row (RN.No / Lot No).");
  const head = rows[hi];
  const idx = {
    purchaseType: colIndex(head, ['PurchaseType']), poNo: colIndex(head, ['PO.No', 'PO No']),
    rnNo: colIndex(head, ['RN.No', 'RN No']), rnDate: colIndex(head, ['RN Date']), lotNo: colIndex(head, ['Lot No']),
    supplier: colIndex(head, ['Supplier Name']), place: colIndex(head, ['Place']), vehicle: colIndex(head, ['Vehicle No']),
    product: colIndex(head, ['Material Name']), billNo: colIndex(head, ['Bill No']), billRate: colIndex(head, ['BillRate']),
    billQty: colIndex(head, ['BillQty']), cgst: colIndex(head, ['CGST']), sgst: colIndex(head, ['SGST']), igst: colIndex(head, ['IGST']),
    billValue: colIndex(head, ['BillValue']), weight: colIndex(head, ['Weight (MT)', 'Weight MT']),
    juteBag: colIndex(head, ['Jute bag']), plasticBag: colIndex(head, ['Plastic Bag']), totalBags: colIndex(head, ["Total Bag's", 'Total Bags']),
    freightAmt: colIndex(head, ['FreightAmt']),
  };
  if ([idx.rnNo, idx.lotNo].some(i => i < 0)) throw new Error('Purchase Register LotWise: header row is missing RN.No or Lot No.');

  const out: ParsedPurchaseReceiptRow[] = [];
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r];
    const rnNo = text(row?.[idx.rnNo]);
    if (!rnNo) continue;
    out.push({
      rnNo, rnDate: calendarDate(row[idx.rnDate]), purchaseType: text(row[idx.purchaseType]), poNo: text(row[idx.poNo]), lotNo: text(row[idx.lotNo]),
      supplierName: text(row[idx.supplier]), place: text(row[idx.place]), vehicleNo: text(row[idx.vehicle]), productRaw: text(row[idx.product]),
      billNo: text(row[idx.billNo]), billRate: money(row[idx.billRate]), billQty: money(row[idx.billQty]),
      cgst: money(row[idx.cgst]), sgst: money(row[idx.sgst]), igst: money(row[idx.igst]), billValue: money(row[idx.billValue]),
      weight: money(row[idx.weight]), juteBag: money(row[idx.juteBag]), plasticBag: money(row[idx.plasticBag]), totalBags: money(row[idx.totalBags]), freightAmt: money(row[idx.freightAmt]),
    });
  }
  if (!out.length) throw new Error('Purchase Register LotWise: no data rows found under the header.');
  return out;
}
