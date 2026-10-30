import * as XLSX from 'xlsx';
import type { EngineResult, TransactionResult } from './engine';

function sheetFrom(headers: string[], rows: (string | number | null)[][], widths?: number[]) {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  if (widths) ws['!cols'] = widths.map(w => ({ wch: w }));
  return ws;
}

export function buildTransactionWorkbook(result: EngineResult): Buffer {
  const wb = XLSX.utils.book_new();
  const { transactions, summary, consolidatedVouchers, sourceStats, warnings } = result;

  const summaryRows: (string | number | null)[][] = [
    ['SVMA AI Transaction Reconciliation'], ['Reconciliation Date', result.reconciliationDate], [],
    ['Total Physical Movements', summary.totalWeighments],
    ['Purchase', summary.purchase], ['Sales', summary.sales], ['Job Work', summary.jobWork], ['Others', summary.others], [],
    ['Fully Reconciled', summary.fullyReconciled], ['Reconciled (AI)', summary.aiReconciled], ['Partial', summary.partial], ['Not Found', summary.exceptions], ['Review', summary.review], [],
    ['Reconciliation %', `${summary.reconciliationPercent}%`], ['Automation %', `${summary.automationPercent}%`], ['Average AI Confidence %', `${summary.averageConfidence}%`], [],
    ['Consolidated Vouchers Detected', consolidatedVouchers.length],
    ['Weighment Rows', sourceStats.weighmentRows], ['Gate Rows', sourceStats.gateRows], ['Unique Tally Vouchers', sourceStats.uniqueTallyVouchers], ['Tally Sheets Recognized', sourceStats.tallySheets], [],
    ...warnings.map(w => ['Warning', w]),
  ];
  XLSX.utils.book_append_sheet(wb, sheetFrom(['', ''], summaryRows.slice(2), [28, 60]), 'SUMMARY');

  const mainHeaders = ['S.No', 'Date', 'Lorry No', 'Party Name', 'Material', 'Net Weight', 'Weighbridge Ref No', 'Category', 'ERP Gate Pass', 'PO/SO', 'Invoice Ref', 'Tally Ref No', 'AI Confidence %', 'Status', 'Comments'];
  const mainRows = transactions.map(t => [t.serialNo, t.date, t.vehicle, t.party, t.material, t.netWeight, t.weighBridgeRef, t.category, t.gate?.gp || '', t.gate?.order || '', t.gate?.invoice || '', t.tallySelected.map(v => v.vchNo).join(', '), t.confidence, t.status, t.comments]);
  XLSX.utils.book_append_sheet(wb, sheetFrom(mainHeaders, mainRows, [6, 12, 14, 26, 20, 12, 18, 10, 16, 16, 16, 18, 12, 16, 70]), 'MAIN');

  function categorySheet(category: TransactionResult['category'], headers: string[], mapRow: (t: TransactionResult, i: number) => (string | number | null)[], widths: number[], name: string) {
    const rows = transactions.filter(t => t.category === category);
    XLSX.utils.book_append_sheet(wb, sheetFrom(headers, rows.map(mapRow), widths), name);
  }
  categorySheet('Purchase', ['S.No', 'Date', 'WB Ref', 'Vehicle', 'Supplier', 'Material', 'Net Weight', 'Gate Pass', 'Purchase Order', 'Supplier Invoice', 'Tally Voucher Type', 'Tally Purchase Ref', 'Confidence %', 'Status', 'Comments'],
    (t, i) => [i + 1, t.date, t.weighBridgeRef, t.vehicle, t.party, t.material, t.netWeight, t.gate?.gp || '', t.gate?.order || '', t.gate?.invoice || '', t.tallySelected[0]?.vchType || '', t.tallySelected.map(v => v.vchNo).join(', '), t.confidence, t.status, t.comments],
    [6, 12, 16, 12, 26, 20, 12, 16, 18, 18, 16, 18, 12, 16, 70], 'PURCHASE');
  categorySheet('Sales', ['S.No', 'Date', 'WB Ref', 'Vehicle', 'Customer', 'Product', 'Net Weight', 'Gate Pass', 'Sales Order', 'Invoice', 'Tally Voucher Type', 'Tally Sales Ref', 'Confidence %', 'Status', 'Comments'],
    (t, i) => [i + 1, t.date, t.weighBridgeRef, t.vehicle, t.party, t.material, t.netWeight, t.gate?.gp || '', t.gate?.order || '', t.gate?.invoice || '', t.tallySelected[0]?.vchType || '', t.tallySelected.map(v => v.vchNo).join(', '), t.confidence, t.status, t.comments],
    [6, 12, 16, 12, 26, 20, 12, 16, 18, 18, 16, 18, 12, 16, 70], 'SALES');
  categorySheet('Job Work', ['S.No', 'Date', 'WB Ref', 'Vehicle', 'Party', 'Material', 'Direction', 'Net Weight', 'Gate Pass', 'Job Work Ref', 'Tally Ref', 'Confidence %', 'Status', 'Comments'],
    (t, i) => [i + 1, t.date, t.weighBridgeRef, t.vehicle, t.party, t.material, t.gate?.direction || '', t.netWeight, t.gate?.gp || '', t.gate?.order || '', t.tallySelected.map(v => v.vchNo).join(', '), t.confidence, t.status, t.comments],
    [6, 12, 16, 12, 26, 20, 10, 12, 16, 18, 18, 12, 16, 70], 'JOB WORK');
  categorySheet('Others', ['S.No', 'Date', 'WB Ref', 'Vehicle', 'Party', 'Material', 'Net Weight', 'Reason', 'Status'],
    (t, i) => [i + 1, t.date, t.weighBridgeRef, t.vehicle, t.party, t.material, t.netWeight, t.categoryReason, t.status],
    [6, 12, 16, 12, 26, 20, 12, 60, 12], 'OTHERS');

  const exceptionRows = transactions.filter(t => t.status !== 'Reconciled' && t.status !== 'Reconciled (AI)' && t.category !== 'Others');
  XLSX.utils.book_append_sheet(wb, sheetFrom(
    ['WB Ref', 'Vehicle', 'Category', 'Party', 'Material', 'Gate Pass', 'PO/SO', 'Confidence %', 'Problem', 'Recommended Action'],
    exceptionRows.map(t => [t.weighBridgeRef, t.vehicle, t.category, t.party, t.material, t.gate?.gp || '', t.gate?.order || '', t.confidence, t.exceptionCode || t.status, t.comments]),
    [16, 12, 10, 26, 20, 16, 16, 12, 26, 70]), 'EXCEPTIONS');

  XLSX.utils.book_append_sheet(wb, sheetFrom(
    ['WB Ref', 'Vehicle', 'Selected Gate Pass', 'Direction', 'Order Ref', 'Candidates Considered', 'Rejected'],
    transactions.map(t => [t.weighBridgeRef, t.vehicle, t.gate?.gp || '', t.gate?.direction || '', t.gate?.order || '', t.gateCandidatesAll.length, t.gateRejectedCount]),
    [16, 12, 18, 10, 16, 18, 10]), 'GATE MAPPING');

  XLSX.utils.book_append_sheet(wb, sheetFrom(
    ['WB Ref', 'Selected Voucher', 'Voucher Type', 'Register Role', 'Order Ref', 'Evidence', 'Consolidated With'],
    transactions.map(t => [t.weighBridgeRef, t.tallySelected.map(v => v.vchNo).join(', '), t.tallySelected[0]?.vchType || '', t.tallySelected[0]?.sheetRole || '', t.tallySelected[0]?.orderRef || '', t.tallyEvidence.join('; '), t.consolidatedWith.join(', ')]),
    [16, 20, 14, 16, 18, 60, 24]), 'TALLY EVIDENCE');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
