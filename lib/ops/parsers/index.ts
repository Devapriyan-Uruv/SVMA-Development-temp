import * as XLSX from 'xlsx';
import { parseFeedingDetails, type ParsedFeedingRow } from './feeding';
import { parseProductionReport, type ParsedProductionRow } from './production';
import { parseStockSummary, type ParsedStockSnapshotRow } from './stockSummary';
import { parseRmBatchStock, type ParsedRmBatchRow } from './rmBatchStock';
import { parsePurchaseOrderPending, type ParsedPoPendingRow } from './purchaseOrderPending';
import { parsePurchaseDetails, type ParsedPurchaseDetailRow } from './purchaseDetails';
import { parseGateIn, type ParsedGateInRow } from './gateIn';
import { parseGateOut, type ParsedGateOutRow } from './gateOut';
import { parseTimeOfficeIn, type ParsedTimeOfficeInRow } from './timeOfficeIn';
import { parseTimeOfficeOut, type ParsedTimeOfficeOutRow } from './timeOfficeOut';
import { parseInwardQc, type ParsedQcSampleRow } from './inwardQc';
import { parseSettlementPending, type ParsedSettlementRow } from './settlementPending';
import { parseSaleOrderDetails, type ParsedSaleOrderRow } from './saleOrderDetails';
import { parseSalesRegister, type ParsedSalesRegisterRow } from './salesRegister';
import { parsePurchaseReceipts, type ParsedPurchaseReceiptRow } from './purchaseReceipts';
import { parseBrokerage, type ParsedBrokerageRow } from './brokerage';
import { parseConsumableIssue, type ParsedConsumableIssueRow } from './consumableIssue';
import { parseEbPowerReading, type ParsedEbPowerReadingRow } from './ebPowerReading';
import { parseFreightSummary, type ParsedFreightSummaryRow } from './freightSummary';
import { parseQcPendingLots, type ParsedQcPendingLotRow } from './qcPendingLots';
import { parseShutDown, type ParsedShutDownRow } from './shutDown';
import { parseSolventDailyReport, type ParsedSolventDailyRow } from './solventDailyReport';
import { parseContractPending, type ParsedContractPendingRow } from './contractPending';
import { parseInwardPayment, type ParsedInwardPaymentRow } from './inwardPayment';
import { parsePurchaseSummary, type ParsedPurchaseSummaryRow } from './purchaseSummary';
import { parseCreditDebitNote, type ParsedCreditDebitNoteRow } from './creditDebitNote';

export const REPORT_TYPES = [
  'feeding', 'production', 'stock_snapshot', 'rm_batch_stock',
  'purchase_order_pending', 'purchase_details', 'gate_in', 'gate_out', 'time_office_in', 'time_office_out',
  'inward_qc', 'settlement_pending', 'sale_order_details', 'sales_register', 'purchase_receipts',
  'brokerage', 'consumable_issue', 'eb_power_reading', 'freight_summary', 'qc_pending_lots',
  'shut_down', 'solvent_daily_report', 'contract_pending', 'inward_payment', 'purchase_summary', 'credit_debit_note',
] as const;
export type ReportType = typeof REPORT_TYPES[number];

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  feeding: 'Feeding Details',
  production: 'Production Report',
  stock_snapshot: 'Stock Summary',
  rm_batch_stock: 'Raw Material Batch Wise Stock',
  purchase_order_pending: 'Purchase Order Pending',
  purchase_details: 'Purchase Details',
  gate_in: 'Gate In Entry',
  gate_out: 'Gate Out Entry',
  time_office_in: 'Time Office In (Inward Weighment)',
  time_office_out: 'Time Office Out (Outward Weighment)',
  inward_qc: 'Inward QC Report',
  settlement_pending: 'Settlement Pending Lot',
  sale_order_details: 'Sale Order Details',
  sales_register: 'Sales Register',
  purchase_receipts: 'Purchase Register (Lot Wise)',
  brokerage: 'Brokerage',
  consumable_issue: 'Consumable Issue',
  eb_power_reading: 'EB Power Reading',
  freight_summary: 'Freight Summary',
  qc_pending_lots: 'QC Pending Lots',
  shut_down: 'Shut Down',
  solvent_daily_report: 'Solvent Daily Report',
  contract_pending: 'Contract List Pending',
  inward_payment: 'Inward Payment',
  purchase_summary: 'Purchase Summary',
  credit_debit_note: 'Credit / Debit Note',
};

/** Snapshot report types are versioned (one active batch per report_date);
 * append-only types accumulate rows across same-day/same-period re-uploads
 * instead. Purchase Order Pending and Settlement Pending are "As on Date"
 * snapshots (confirmed from the real files' own title text); Contract List
 * Pending is the same "As On Date" shape, confirmed from its own title
 * text. Everything else is a transaction log with its own per-row date. */
export const SNAPSHOT_REPORT_TYPES = new Set<ReportType>(['stock_snapshot', 'rm_batch_stock', 'purchase_order_pending', 'settlement_pending', 'contract_pending']);

export type ParsedReport =
  | { reportType: 'feeding'; reportDate: string; rows: ParsedFeedingRow[] }
  | { reportType: 'production'; reportDate: string; rows: ParsedProductionRow[] }
  | { reportType: 'stock_snapshot'; reportDate: string; rows: ParsedStockSnapshotRow[] }
  | { reportType: 'rm_batch_stock'; reportDate: string; rows: ParsedRmBatchRow[] }
  | { reportType: 'purchase_order_pending'; reportDate: string; rows: ParsedPoPendingRow[] }
  | { reportType: 'purchase_details'; reportDate: string; rows: ParsedPurchaseDetailRow[] }
  | { reportType: 'gate_in'; reportDate: string; rows: ParsedGateInRow[] }
  | { reportType: 'gate_out'; reportDate: string; rows: ParsedGateOutRow[] }
  | { reportType: 'time_office_in'; reportDate: string; rows: ParsedTimeOfficeInRow[] }
  | { reportType: 'time_office_out'; reportDate: string; rows: ParsedTimeOfficeOutRow[] }
  | { reportType: 'inward_qc'; reportDate: string; rows: ParsedQcSampleRow[] }
  | { reportType: 'settlement_pending'; reportDate: string; rows: ParsedSettlementRow[] }
  | { reportType: 'sale_order_details'; reportDate: string; rows: ParsedSaleOrderRow[] }
  | { reportType: 'sales_register'; reportDate: string; rows: ParsedSalesRegisterRow[] }
  | { reportType: 'purchase_receipts'; reportDate: string; rows: ParsedPurchaseReceiptRow[] }
  | { reportType: 'brokerage'; reportDate: string; rows: ParsedBrokerageRow[] }
  | { reportType: 'consumable_issue'; reportDate: string; rows: ParsedConsumableIssueRow[] }
  | { reportType: 'eb_power_reading'; reportDate: string; rows: ParsedEbPowerReadingRow[] }
  | { reportType: 'freight_summary'; reportDate: string; rows: ParsedFreightSummaryRow[] }
  | { reportType: 'qc_pending_lots'; reportDate: string; rows: ParsedQcPendingLotRow[] }
  | { reportType: 'shut_down'; reportDate: string; rows: ParsedShutDownRow[] }
  | { reportType: 'solvent_daily_report'; reportDate: string; rows: ParsedSolventDailyRow[] }
  | { reportType: 'contract_pending'; reportDate: string; rows: ParsedContractPendingRow[] }
  | { reportType: 'inward_payment'; reportDate: string; rows: ParsedInwardPaymentRow[] }
  | { reportType: 'purchase_summary'; reportDate: string; rows: ParsedPurchaseSummaryRow[] }
  | { reportType: 'credit_debit_note'; reportDate: string; rows: ParsedCreditDebitNoteRow[] };

export function parseOpsReport(reportType: ReportType, book: XLSX.WorkBook): ParsedReport {
  if (reportType === 'feeding') { const rows = parseFeedingDetails(book); return { reportType, reportDate: rows[0].reportDate, rows }; }
  if (reportType === 'production') { const rows = parseProductionReport(book); return { reportType, reportDate: rows[0].reportDate, rows }; }
  if (reportType === 'stock_snapshot') { const { reportDate, rows } = parseStockSummary(book); return { reportType, reportDate, rows }; }
  if (reportType === 'rm_batch_stock') { const { asOfDate, rows } = parseRmBatchStock(book); return { reportType, reportDate: asOfDate, rows }; }
  if (reportType === 'purchase_order_pending') { const { asOfDate, rows } = parsePurchaseOrderPending(book); return { reportType, reportDate: asOfDate, rows }; }
  if (reportType === 'purchase_details') { const rows = parsePurchaseDetails(book); return { reportType, reportDate: rows[0].poDate || rows[rows.length - 1].poDate, rows }; }
  if (reportType === 'gate_in') { const rows = parseGateIn(book); return { reportType, reportDate: rows[0].movementDate, rows }; }
  if (reportType === 'gate_out') { const rows = parseGateOut(book); return { reportType, reportDate: rows[0].movementDate, rows }; }
  if (reportType === 'time_office_in') { const rows = parseTimeOfficeIn(book); return { reportType, reportDate: rows[0].weighmentDate, rows }; }
  if (reportType === 'time_office_out') { const rows = parseTimeOfficeOut(book); return { reportType, reportDate: rows[0].weighmentDate, rows }; }
  if (reportType === 'inward_qc') { const rows = parseInwardQc(book); return { reportType, reportDate: rows[0].reportDate, rows }; }
  if (reportType === 'settlement_pending') { const { asOfDate, rows } = parseSettlementPending(book); return { reportType, reportDate: asOfDate, rows }; }
  if (reportType === 'sale_order_details') { const rows = parseSaleOrderDetails(book); return { reportType, reportDate: rows[0].soDate, rows }; }
  if (reportType === 'sales_register') { const rows = parseSalesRegister(book); return { reportType, reportDate: rows[0].invoiceDate, rows }; }
  if (reportType === 'purchase_receipts') { const rows = parsePurchaseReceipts(book); return { reportType, reportDate: rows[0].rnDate || rows[rows.length - 1].rnDate, rows }; }
  if (reportType === 'brokerage') { const rows = parseBrokerage(book); return { reportType, reportDate: rows[0].conDate, rows }; }
  if (reportType === 'consumable_issue') { const rows = parseConsumableIssue(book); return { reportType, reportDate: rows[0].issueDate, rows }; }
  if (reportType === 'eb_power_reading') { const rows = parseEbPowerReading(book); return { reportType, reportDate: rows[0].reportDate, rows }; }
  if (reportType === 'freight_summary') { const rows = parseFreightSummary(book); return { reportType, reportDate: rows[0].invoiceDate, rows }; }
  if (reportType === 'qc_pending_lots') { const rows = parseQcPendingLots(book); return { reportType, reportDate: rows[0].pendingDate, rows }; }
  if (reportType === 'shut_down') { const rows = parseShutDown(book); return { reportType, reportDate: rows[0].effectiveDate, rows }; }
  if (reportType === 'solvent_daily_report') { const rows = parseSolventDailyReport(book); return { reportType, reportDate: rows[0].reportDate, rows }; }
  if (reportType === 'contract_pending') { const { asOfDate, rows } = parseContractPending(book); return { reportType, reportDate: asOfDate, rows }; }
  if (reportType === 'inward_payment') { const rows = parseInwardPayment(book); return { reportType, reportDate: rows[0].paymentDate, rows }; }
  if (reportType === 'purchase_summary') { const rows = parsePurchaseSummary(book); return { reportType, reportDate: rows[0].inwardDate, rows }; }
  if (reportType === 'credit_debit_note') { const rows = parseCreditDebitNote(book); return { reportType, reportDate: rows[0].date, rows }; }
  throw new Error(`Unsupported operations report type: ${reportType}`);
}
