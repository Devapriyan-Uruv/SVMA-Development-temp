// Source-neutral evidence records. Whether a record came from an uploaded
// file or from the Operations database, it is normalized to the same shape
// and carries where it came from (Prov) so every matched value can be traced
// back to a file/sheet/row (or table/row id) and its raw value.

export type Prov = { origin: 'upload' | 'operations_db'; file: string; sheet: string; row: string };

// juteBag/plasticBag/totalBags: bag counts on the receipt. The ERP's receipt weight is the weighbridge net LESS the bags
// (jute 1 kg/bag; plastic 0.2 kg/bag for the products that carry it) — see build.ts.
export type ReceiptRec = { rnNo: string; rnDate: string; poNo: string; lotNo: string; supplier: string; vehicle: string; product: string; billNo: string; billRate: number | null; billQty: number | null; weight: number | null; billValue: number | null; juteBag: number | null; plasticBag: number | null; totalBags: number | null; prov: Prov };
export type QcRec = { referenceNo: string; lotNo: string; date: string; sampleCode: string; oil: number | null; prov: Prov };
export type SettlementRec = { referenceNo: string; lotNo: string; date: string; quantity: number | null; oil: number | null; prov: Prov };
// value/sgst/cgst/igst are the Credit/Debit Note's own bill-side GST
// breakdown (tied to `value`, the assessable value); rebateIgst/Cgst/Sgst
// are the SAME breakdown tied to `rebateValue` instead — the note's two
// real GST computations, at the bill stage and the rebate stage. weightment/
// unloading/tds are the note's own standalone charge lines.
export type CdnRec = {
  referenceNumber: string; poNo: string; lotNo: string; invoiceNo: string; date: string;
  /** The note's own "PurchaseType" column (Direct Purchase / Indirect Purchase). */
  purchaseType: string;
  customerName: string;
  /** Gunny (jute) bags on the note, the per-bag gunny rate and the resulting gunny cost (JuteBag x PackRate). */
  juteBag: number | null; packRate: number | null; packCost: number | null;
  /** The note's "Advance" column: the amount already paid to the supplier before settlement (the whole bill, for advance suppliers). */
  advance: number | null;
  netWeight: number | null; finalWeight: number | null; labOil: number | null; repOil: number | null;
  billRate: number | null; finalRate: number | null; billValue: number | null; rebateValue: number | null; rebateNetValue: number | null; netValue: number | null;
  value: number | null; sgst: number | null; cgst: number | null; igst: number | null; totalGst: number | null;
  rebateIgst: number | null; rebateCgst: number | null; rebateSgst: number | null;
  weightment: number | null; unloading: number | null; tds: number | null; prov: Prov;
};
// qtyMt is the register's "Quantity MT/No's" column; qtyKg its "Quantity KG/Ltr" column and packing the pack size. For job-work invoices (JW...)
// qtyMt is a bag COUNT, so their weight is qtyKg. `parts` is set when one weighment carries several invoices (see build.ts).
export type SalesInvoiceRec = { invoiceNo: string; soNo: string; date: string; party: string; vehicle: string; product: string; qtyMt: number | null; qtyKg?: number | null; packing?: string; rate: number | null; amount: number | null; totalInvoiceAmount: number | null; place?: string; taxAmount?: number | null; parts?: SalesInvoiceRec[]; prov: Prov };
export type SaleOrderRec = { soNo: string; date: string; customer: string; product: string; quantity: number | null; rate: number | null; status: string; prov: Prov };
export type PoRec = { poNo: string; date: string; supplier: string; product: string; orderedQty: number | null; rate: number | null; prov: Prov };
export type TimeOfficeRec = { gatePassNo: string; lotNo: string; poNo: string; vehicle: string; gross: number | null; tare: number | null; net: number | null; gunnyBags: number | null; plasticBags: number | null; totalBags: number | null; prov: Prov };
export type LotRec = { lotNo: string; poNo: string; productId: string | null; productRaw: string | null; prov: Prov };

export type EvidenceBundle = {
  receipts: ReceiptRec[]; qc: QcRec[]; settlements: SettlementRec[]; cdn: CdnRec[];
  salesInvoices: SalesInvoiceRec[]; saleOrders: SaleOrderRec[]; pos: PoRec[]; timeOffice: TimeOfficeRec[]; lots: LotRec[];
};
export const emptyBundle = (): EvidenceBundle => ({ receipts: [], qc: [], settlements: [], cdn: [], salesInvoices: [], saleOrders: [], pos: [], timeOffice: [], lots: [] });
