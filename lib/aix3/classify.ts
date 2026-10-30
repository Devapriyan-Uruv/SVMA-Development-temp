import * as XLSX from 'xlsx';
import { aix3Complete, aix3Enabled, parseAix3Json } from './provider';
import { REPORT_TYPES, REPORT_TYPE_LABELS, type ReportType } from '@/lib/ops/parsers/index';

const CONFIDENCE_THRESHOLD = 0.75;

// Every ERP export's Excel sheet name is a stable, machine-generated
// identifier (not user-typed) — each parser already locates its own sheet
// with a regex proven against every real sample file this session. Reusing
// those same patterns here as a deterministic pre-check is far more
// reliable than asking the model to tell apart two structurally similar
// reports from a text sample alone: confirmed live that AIX3 misclassified
// "Time Office In Report.xlsx" (sheet "TimeOffice") as gate_in at 95%
// confidence — high-confidence and silently wrong is the worst failure mode
// for this step, since the actual weighment data (lot/net weight) would
// never reach ops_weighments. A sheet-name match is checked FIRST and wins
// outright; AIX3 is still called for report_date/header_row/entity
// enrichment on a match, and remains the sole source of truth only for
// files whose sheet name doesn't match any known pattern.
const SHEET_NAME_PATTERNS: [ReportType, RegExp][] = [
  ['feeding', /issue.*detail/i],
  ['production', /batchfilling|production/i],
  ['stock_snapshot', /stocksummary/i],
  ['rm_batch_stock', /rmbatch|batchwise/i],
  ['purchase_order_pending', /popending/i],
  ['purchase_details', /purchaseorder/i],
  ['purchase_receipts', /purchaseregister/i],
  ['time_office_out', /timeoutoffice|timeofficeout/i],
  ['gate_out', /gateoutentry/i],
  ['gate_in', /gateentry/i],
  ['inward_qc', /inwardqc/i],
  ['settlement_pending', /setpen/i],
  ['sale_order_details', /saleorderdetails/i],
  ['sales_register', /salesdetails/i],
  ['brokerage', /brokerage/i],
  ['consumable_issue', /consumable/i],
  ['eb_power_reading', /ebpower/i],
  ['freight_summary', /freight/i],
  ['qc_pending_lots', /qcpending/i],
  ['shut_down', /shutdown/i],
  ['solvent_daily_report', /solventdays/i],
  ['contract_pending', /pendingcontract/i],
  ['inward_payment', /inwardpay/i],
  ['purchase_summary', /purchasesum/i],
  ['credit_debit_note', /creditlist/i],
];
export function deterministicGuess(book: XLSX.WorkBook): ReportType | null {
  // time_office_in and time_office_out share the "timeoffice" substring —
  // check the more specific "out" pattern first, then match "timeoffice
  // but not out" explicitly rather than relying on array order alone.
  if (book.SheetNames.some(s => /timeoffice/i.test(s) && !/out/i.test(s))) return 'time_office_in';
  for (const [type, pattern] of SHEET_NAME_PATTERNS) if (book.SheetNames.some(s => pattern.test(s))) return type;
  return null;
}

export type ClassificationResult = {
  reportType: ReportType | null;
  confidence: number;
  reportDate: string | null;
  headerRow: number | null;
  detectedEntities: string[];
  needsConfirmation: boolean;
  reason: string;
};

/** Extracts lightweight metadata only — never sends a full workbook to the
 * model. Filename, every sheet name, the first ~8 rows of the first sheet
 * (title block + header row are always in this range in every real file
 * inspected this session), and 2 sample data rows below the detected
 * header. */
function extractMetadata(fileName: string, book: XLSX.WorkBook) {
  const sheetNames = book.SheetNames;
  const firstSheet = sheetNames[0];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[firstSheet], { header: 1, raw: false, defval: null }).slice(0, 12);
  return { fileName, sheetNames, firstSheetPreviewRows: rows };
}

const INSTRUCTIONS = `You classify uploaded ERP export files for SVMA's Operations Intelligence system.
Given a filename, sheet names, and the first ~12 rows of the first sheet (title block + header row + a couple of data rows), identify which known report type this file is.
Known report types: ${REPORT_TYPES.join(', ')}.
Also identify: the 0-indexed row number of the real column-header row (the row containing field names like "Reference No", "Date", "Product Name" — not the title/letterhead block above it), the report's date or date-range if visible in the title text (return as YYYY-MM-DD; if a range, return the "to" date), and which of these entities the report clearly contains: product, shift, time_slot, lot, vehicle, supplier, customer, po, so, invoice.
If you are not confident which known type this is, say so honestly with a lower confidence — never guess to force a match.
Return JSON only: {"report_type": "<one of the known types, or null>", "confidence": 0.0-1.0, "report_date": "YYYY-MM-DD or null", "header_row": <number or null>, "detected_entities": ["..."]}`;

export async function classifyReport(fileName: string, book: XLSX.WorkBook): Promise<ClassificationResult> {
  const meta = extractMetadata(fileName, book);
  const sheetMatch = deterministicGuess(book);

  if (!aix3Enabled()) {
    if (sheetMatch) return { reportType: sheetMatch, confidence: 0.99, reportDate: null, headerRow: null, detectedEntities: [], needsConfirmation: false, reason: '' };
    return { reportType: null, confidence: 0, reportDate: null, headerRow: null, detectedEntities: [], needsConfirmation: true, reason: 'AIX3 classification is unavailable (no API key configured) — choose the report type manually.' };
  }
  try {
    const raw = await aix3Complete({ feature: 'Report Classification', instructions: INSTRUCTIONS, input: JSON.stringify(meta), timeout: 20000 });
    const parsed = parseAix3Json<{ report_type: string | null; confidence: number; report_date: string | null; header_row: number | null; detected_entities: string[] }>(raw);
    if (!parsed) {
      if (sheetMatch) return { reportType: sheetMatch, confidence: 0.99, reportDate: null, headerRow: null, detectedEntities: [], needsConfirmation: false, reason: '' };
      return { reportType: null, confidence: 0, reportDate: null, headerRow: null, detectedEntities: [], needsConfirmation: true, reason: 'AIX3 could not classify this file — choose the report type manually.' };
    }
    const aiReportType = REPORT_TYPES.includes(parsed.report_type as ReportType) ? (parsed.report_type as ReportType) : null;
    // A sheet-name match always wins over the model's own answer — see
    // deterministicGuess's doc comment for why this exists.
    const reportType = sheetMatch || aiReportType;
    const confidence = sheetMatch ? 0.99 : (Number.isFinite(parsed.confidence) ? Math.max(0, Math.min(1, parsed.confidence)) : 0);
    const needsConfirmation = !reportType || confidence < CONFIDENCE_THRESHOLD;
    return {
      reportType, confidence, reportDate: parsed.report_date || null, headerRow: parsed.header_row ?? null,
      detectedEntities: Array.isArray(parsed.detected_entities) ? parsed.detected_entities.slice(0, 10) : [],
      needsConfirmation,
      reason: needsConfirmation ? (reportType ? `AIX3 identified this as ${REPORT_TYPE_LABELS[reportType] || reportType} at ${Math.round(confidence * 100)}% confidence — below the ${Math.round(CONFIDENCE_THRESHOLD * 100)}% threshold, please confirm.` : 'AIX3 could not match this file to a known report type — choose one manually.') : '',
    };
  } catch {
    if (sheetMatch) return { reportType: sheetMatch, confidence: 0.99, reportDate: null, headerRow: null, detectedEntities: [], needsConfirmation: false, reason: '' };
    return { reportType: null, confidence: 0, reportDate: null, headerRow: null, detectedEntities: [], needsConfirmation: true, reason: 'AIX3 classification failed or timed out — choose the report type manually.' };
  }
}
