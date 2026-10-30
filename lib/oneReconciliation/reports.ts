import * as XLSX from 'xlsx';
import { classifyReport, deterministicGuess, type ClassificationResult } from '@/lib/aix3/classify';
import { parseOpsReport, REPORT_TYPE_LABELS, type ReportType } from '@/lib/ops/parsers/index';
import { emptyBundle, type EvidenceBundle, type Prov } from './records';
import type { ReportUnderstanding } from './master';

// "Understand each uploaded workbook": every extra file is identified by the
// existing classifier (deterministic sheet-name match first, AIX3 only when
// that fails), then parsed by the existing header-by-CONTENT Operations
// parsers — so a moved/renamed column is tolerated the same way it already
// is for the Operations Data Hub. Nothing here writes to the database.

const USED: ReportType[] = ['purchase_receipts', 'purchase_details', 'purchase_order_pending', 'inward_qc', 'settlement_pending', 'credit_debit_note', 'sales_register', 'sale_order_details', 'time_office_in', 'time_office_out'];

export async function ingestReports(files: { file: string; book: XLSX.WorkBook }[]): Promise<{ bundle: EvidenceBundle; understanding: ReportUnderstanding[] }> {
  const bundle = emptyBundle();
  const understanding: ReportUnderstanding[] = [];
  // Identification (which may fall back to an AI call for unfamiliar sheets)
  // runs in parallel batches; parsing stays sequential so bundle order is stable.
  const classified: ClassificationResult[] = [];
  const failures = new Map<number, unknown>();
  for (let i = 0; i < files.length; i += 6) {
    const batch = files.slice(i, i + 6);
    const res = await Promise.allSettled(batch.map(f => deterministicGuess(f.book)
      // A machine-generated sheet name identifies the report outright — no AI call needed.
      ? Promise.resolve<ClassificationResult>({ reportType: deterministicGuess(f.book), confidence: 0.99, reportDate: null, headerRow: null, detectedEntities: [], needsConfirmation: false, reason: 'sheet-name match' })
      : classifyReport(f.file, f.book)));
    res.forEach((r, j) => { if (r.status === 'fulfilled') classified[i + j] = r.value; else failures.set(i + j, r.reason); });
  }
  for (const [fi, { file, book }] of files.entries()) {
    const sheet = book.SheetNames[0] || '';
    try {
      if (failures.has(fi)) throw failures.get(fi);
      const cls = classified[fi];
      if (!cls.reportType || cls.needsConfirmation) {
        understanding.push({ file, detectedType: cls.reportType, label: cls.reportType ? REPORT_TYPE_LABELS[cls.reportType] : 'Unrecognized', confidence: cls.confidence, method: cls.confidence >= 0.99 ? 'sheet-name match' : 'AIX3 classification', sheet, rows: 0, status: 'unrecognized', note: cls.reason || 'Could not identify this report — it was not used.' });
        continue;
      }
      const label = REPORT_TYPE_LABELS[cls.reportType];
      const method = cls.confidence >= 0.99 ? 'sheet-name match (deterministic)' : 'AIX3 classification';
      if (!USED.includes(cls.reportType)) {
        understanding.push({ file, detectedType: cls.reportType, label, confidence: cls.confidence, method, sheet, rows: 0, status: 'unrecognized', note: `Identified as ${label}, but this report is not part of the reconciliation chain — not used.` });
        continue;
      }
      const parsed = parseOpsReport(cls.reportType, book);
      const P = (i: number): Prov => ({ origin: 'upload', file, sheet, row: `parsed row ${i + 1}` });
      const t = parsed.reportType;
      if (t === 'purchase_receipts') parsed.rows.forEach((r, i) => { bundle.receipts.push({ rnNo: r.rnNo, rnDate: r.rnDate, poNo: r.poNo, lotNo: r.lotNo, supplier: r.supplierName, vehicle: r.vehicleNo, product: r.productRaw, billNo: r.billNo, billRate: r.billRate, billQty: r.billQty, weight: r.weight, billValue: r.billValue, juteBag: r.juteBag, plasticBag: r.plasticBag, totalBags: r.totalBags, prov: P(i) }); if (r.lotNo) bundle.lots.push({ lotNo: r.lotNo, poNo: r.poNo, productId: null, productRaw: r.productRaw, prov: P(i) }); });
      else if (t === 'inward_qc') parsed.rows.forEach((r, i) => { bundle.qc.push({ referenceNo: r.referenceNo, lotNo: r.lotNo, date: r.reportDate, sampleCode: r.sampleCode, oil: r.oil, prov: P(i) }); bundle.lots.push({ lotNo: r.lotNo, poNo: '', productId: null, productRaw: r.productRaw, prov: P(i) }); });
      else if (t === 'settlement_pending') parsed.rows.forEach((r, i) => { bundle.settlements.push({ referenceNo: r.referenceNo, lotNo: r.lotNo, date: r.inwardDate, quantity: r.quantity, oil: r.oil, prov: P(i) }); if (r.lotNo) bundle.lots.push({ lotNo: r.lotNo, poNo: '', productId: null, productRaw: r.productRaw, prov: P(i) }); });
      else if (t === 'credit_debit_note') parsed.rows.forEach((r, i) => { bundle.cdn.push({ referenceNumber: r.referenceNumber, poNo: r.poNo, lotNo: r.lotNo, invoiceNo: r.invoiceNo, date: r.date, purchaseType: r.purchaseType, customerName: r.customerName, juteBag: r.juteBag, packRate: r.packRate, packCost: r.packCost, advance: r.advance, netWeight: r.netWeight, finalWeight: r.finalWeight, labOil: r.labOil, repOil: r.repOil, billRate: r.billRate, finalRate: r.finalRate, billValue: r.billValue, rebateValue: r.rebateValue, rebateNetValue: r.rebateNetValue, netValue: r.netValue, value: r.value, sgst: r.sgst, cgst: r.cgst, igst: r.igst, totalGst: r.totalGst, rebateIgst: r.rebateIgst, rebateCgst: r.rebateCgst, rebateSgst: r.rebateSgst, weightment: r.weightment, unloading: r.unloading, tds: r.tds, prov: P(i) }); bundle.lots.push({ lotNo: r.lotNo, poNo: r.poNo, productId: null, productRaw: r.productRaw, prov: P(i) }); });
      else if (t === 'sales_register') parsed.rows.forEach((r, i) => bundle.salesInvoices.push({ invoiceNo: r.invoiceNo, soNo: r.soNo, date: r.invoiceDate, party: r.partyName, vehicle: r.vehicleNo, product: r.productRaw, qtyMt: r.quantityMt, rate: r.rate, amount: r.amount, totalInvoiceAmount: r.totalInvoiceAmount, place: r.place, taxAmount: r.taxAmount, qtyKg: r.quantityKg, packing: r.packingSize, prov: P(i) }));
      else if (t === 'sale_order_details') parsed.rows.forEach((r, i) => bundle.saleOrders.push({ soNo: r.soNo, date: r.soDate, customer: r.customerName, product: r.productRaw, quantity: r.quantity, rate: r.rate, status: r.status, prov: P(i) }));
      else if (t === 'purchase_details') parsed.rows.forEach((r, i) => bundle.pos.push({ poNo: r.poNo, date: r.poDate, supplier: r.supplierName, product: r.productRaw, orderedQty: r.orderedQty, rate: r.rate, prov: P(i) }));
      else if (t === 'purchase_order_pending') parsed.rows.forEach((r, i) => bundle.pos.push({ poNo: r.poNo, date: r.poDate, supplier: r.supplierName, product: r.productRaw, orderedQty: r.orderedQty, rate: r.rate, prov: P(i) }));
      else if (t === 'time_office_in') parsed.rows.forEach((r, i) => { bundle.timeOffice.push({ gatePassNo: r.gatePassNo, lotNo: r.lotNo, poNo: r.poNo, vehicle: r.vehicleNo, gross: r.grossWeight, tare: r.tareWeight, net: r.netWeight, gunnyBags: r.gunnyBags, plasticBags: r.plasticBags, totalBags: r.totalBags, prov: P(i) }); if (r.lotNo) bundle.lots.push({ lotNo: r.lotNo, poNo: r.poNo, productId: null, productRaw: r.productRaw, prov: P(i) }); });
      understanding.push({ file, detectedType: cls.reportType, label, confidence: cls.confidence, method, sheet, rows: parsed.rows.length, status: 'used', note: `${parsed.rows.length} row(s) read; held in memory for this run only.` });
    } catch (e) {
      understanding.push({ file, detectedType: null, label: 'Unreadable', confidence: 0, method: 'none', sheet, rows: 0, status: 'error', note: e instanceof Error ? e.message : 'Could not read this file.' });
    }
  }
  // Overlapping exports (e.g. a morning and an afternoon Sales Register) repeat
  // the same records; identical rows must count once.
  const uniq = <T extends { prov: Prov }>(a: T[]): T[] => { const seen = new Set<string>(); return a.filter(r => { const { prov, ...rest } = r; const k = JSON.stringify(rest); if (seen.has(k)) return false; seen.add(k); return true; }); };
  bundle.receipts = uniq(bundle.receipts); bundle.qc = uniq(bundle.qc); bundle.settlements = uniq(bundle.settlements); bundle.cdn = uniq(bundle.cdn);
  bundle.salesInvoices = uniq(bundle.salesInvoices); bundle.saleOrders = uniq(bundle.saleOrders); bundle.pos = uniq(bundle.pos); bundle.timeOffice = uniq(bundle.timeOffice); bundle.lots = uniq(bundle.lots);
  return { bundle, understanding };
}
