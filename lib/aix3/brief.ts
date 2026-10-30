import { supabaseAdmin } from '@/lib/supabase/admin';
import { aix3Complete, aix3Enabled, parseAix3Json } from './provider';
import { getDailyOperationsSummary, getOpenExceptions } from './tools';

const MODULE_LABEL: Record<string, string> = { ops_production: 'Production', ops_raw_material: 'Raw Material', ops_qc: 'QC & Settlement', ops_sales: 'Sales' };

export type OperationsBrief = {
  summary: string;
  productionSummary: string;
  inventorySummary: string;
  supplySummary: string;
  salesSummary: string;
  exceptionsSummary: string;
  risks: string[];
  actionsRequired: string[];
};

function deterministicBrief(summary: any, exceptions: any[]): OperationsBrief {
  const openCritical = exceptions.filter(e => e.severity === 'critical');
  return {
    summary: summary ? `Data as of ${summary.report_date}. ${summary.open_exceptions_count || 0} open exception(s), ${summary.critical_exceptions_count || 0} critical.` : 'No operations data has been processed yet.',
    productionSummary: summary ? `Production ${Number(summary.production_total_qty_mt || 0).toFixed(1)} MT, feeding ${Number(summary.feeding_total_weight_mt || 0).toFixed(1)} MT.` : '',
    inventorySummary: summary ? `Stock closing value ₹${Math.round(Number(summary.stock_closing_value || 0)).toLocaleString('en-IN')}.` : '',
    supplySummary: '',
    salesSummary: '',
    exceptionsSummary: exceptions.length ? `${exceptions.length} open exception(s): ${exceptions.slice(0, 3).map(e => e.description).join(' ')}` : 'No open exceptions.',
    risks: openCritical.map(e => e.description).slice(0, 5),
    actionsRequired: exceptions.filter(e => e.status === 'open').map(e => e.description).slice(0, 5),
  };
}

/** "Today's Operations Story" — generated strictly from already-computed
 * facts (ops_daily_control_summary + ops_exceptions via lib/aix3/tools.ts),
 * never raw transaction tables and never a number AIX3 invents itself. A
 * rule-based fallback covers no-API-key/failure so the Control Tower always
 * has something coherent to show. */
export async function generateOperationsBrief(reportDate: string): Promise<OperationsBrief> {
  const db = supabaseAdmin();
  const [summary, exceptions] = await Promise.all([getDailyOperationsSummary(reportDate), getOpenExceptions({ from: reportDate, to: reportDate })]);
  const fallback = deterministicBrief(summary, exceptions);
  if (!aix3Enabled()) return fallback;
  try {
    // Strip/relabel internal bookkeeping fields (row id, cache/compute
    // timestamp, raw module keys like "ops_raw_material") before handing
    // facts to AIX3 — confirmed live that without this it echoes them
    // verbatim into user-facing prose (e.g. a literal "computed at
    // 2026-...Z" sentence, or "logged under erp_raw_material module").
    const { id: _summaryId, computed_at: _computedAt, ...summaryForBrief } = (summary || {}) as Record<string, unknown>;
    const exceptionsForBrief = exceptions.map(({ id: _id, module, ...rest }: any) => ({ ...rest, area: MODULE_LABEL[module] || module }));
    const instructions = 'You write a short daily operations brief for SVMA plant management from the supplied facts JSON only — never invent a number, name, or event not present in it. Never quote raw system fields verbatim (timestamps, ids, internal keys) — write in plain business language only. Structure: 1) what happened 2) what matched 3) what did not match 4) what is pending 5) what is at risk 6) what needs action today. Keep each field to 1-2 sentences; risks/actionsRequired are short bullet strings. Return JSON only: {"summary":"...","productionSummary":"...","inventorySummary":"...","supplySummary":"...","salesSummary":"...","exceptionsSummary":"...","risks":["..."],"actionsRequired":["..."]}';
    const raw = await aix3Complete({ feature: 'Operations Brief', instructions, input: JSON.stringify({ summary: summaryForBrief, exceptions: exceptionsForBrief }), timeout: 30000 });
    const parsed = parseAix3Json<OperationsBrief>(raw);
    if (!parsed || typeof parsed.summary !== 'string') return fallback;
    const brief: OperationsBrief = { ...fallback, ...parsed, risks: Array.isArray(parsed.risks) ? parsed.risks.slice(0, 8) : fallback.risks, actionsRequired: Array.isArray(parsed.actionsRequired) ? parsed.actionsRequired.slice(0, 8) : fallback.actionsRequired };
    await db.from('ops_management_briefs').upsert({ report_date: reportDate, period_label: 'daily', brief }, { onConflict: 'report_date' });
    return brief;
  } catch {
    return fallback;
  }
}
