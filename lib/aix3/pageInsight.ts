import { supabaseAdmin } from '@/lib/supabase/admin';
import { aix3Complete, aix3Enabled, parseAix3Json } from './provider';
import { getOpenExceptions } from './tools';
import { fetchAllRows } from '@/lib/supabase/fetchAll';

export type PageModule = 'supply' | 'production' | 'quality_settlement' | 'sales' | 'exceptions';

// Real values ops_exceptions.module is ever written with — confirmed via
// grep across lib/ops/*.ts, not guessed.
const EXCEPTION_MODULES: Record<PageModule, string[]> = {
  supply: ['ops_supply'],
  production: ['ops_production', 'ops_raw_material'],
  quality_settlement: ['ops_qc'],
  sales: ['ops_sales'],
  exceptions: ['ops_production', 'ops_raw_material', 'ops_qc', 'ops_supply', 'ops_sales'],
};

export type PageInsight = { summary: string; needsAttention: string[] };

async function gatherFacts(module: PageModule) {
  const db = supabaseAdmin();
  const exceptions = (await Promise.all(EXCEPTION_MODULES[module].map(m => getOpenExceptions({ module: m })))).flat();
  const facts: Record<string, unknown> = {
    openExceptionsCount: exceptions.length,
    criticalCount: exceptions.filter((e: any) => e.severity === 'critical').length,
    topExceptions: exceptions.slice(0, 5).map((e: any) => ({ type: e.exception_type, severity: e.severity, description: e.description })),
  };

  if (module === 'supply') {
    // "is_active" can be true for several batches at once (one per
    // report_date — see sql/054's comment on this same point) so this
    // needs order+limit(1) before maybeSingle(), exactly like
    // app/api/ops/supply/dashboard/route.ts does — omitting it (confirmed
    // live) makes maybeSingle() error on >1 row and silently fall back to
    // "no active batch", undercounting open POs as 0.
    const { data: activeBatch } = await db.from('ops_upload_batches').select('id').eq('report_type', 'purchase_order_pending').eq('is_active', true).order('report_date', { ascending: false }).limit(1).maybeSingle();
    const { data: openPos } = activeBatch ? await db.from('ops_purchase_orders').select('po_no,po_date').eq('upload_batch_id', (activeBatch as any).id) : { data: [] as any[] };
    // ops_gate_movements/ops_weighments (direction=IN) already exceed 1000
    // rows each — a bare select() silently drops the rest (see
    // lib/supabase/fetchAll.ts), which was undercounting
    // vehiclesAwaitingWeighment and could pick a stale "longest waiting"
    // gate pass. ops_lots is paged too, pre-emptively, for the same reason.
    const [{ data: gateIn }, { data: weighedIn }, { data: lots }] = await Promise.all([
      fetchAllRows<any>((rangeFrom, rangeTo) => db.from('ops_gate_movements').select('gate_pass_no,movement_date').eq('direction', 'IN').range(rangeFrom, rangeTo)),
      fetchAllRows<any>((rangeFrom, rangeTo) => db.from('ops_weighments').select('gate_pass_no').eq('direction', 'IN').range(rangeFrom, rangeTo)),
      fetchAllRows<any>((rangeFrom, rangeTo) => db.from('ops_lots').select('status').range(rangeFrom, rangeTo)),
    ]);
    const weighed = new Set((weighedIn || []).map((r: any) => r.gate_pass_no));
    const waitingGate = (gateIn || []).filter((g: any) => !weighed.has(g.gate_pass_no)).sort((a: any, b: any) => (a.movement_date || '').localeCompare(b.movement_date || ''))[0];
    const oldestPo = [...(openPos || [])].filter((p: any) => p.po_date).sort((a: any, b: any) => a.po_date.localeCompare(b.po_date))[0];
    const daysSince = (d: string) => Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
    facts.openPoCount = (openPos || []).length;
    facts.vehiclesAwaitingWeighment = (gateIn || []).filter((g: any) => !weighed.has(g.gate_pass_no)).length;
    facts.lotsInProgress = (lots || []).filter((l: any) => l.status !== 'COMPLETED').length;
    if (oldestPo) facts.oldestOpenPo = { poNo: oldestPo.po_no, daysOpen: daysSince(oldestPo.po_date) };
    if (waitingGate?.movement_date) facts.longestWaitingGatePass = { gatePassNo: waitingGate.gate_pass_no, daysWaiting: daysSince(waitingGate.movement_date) };
  } else if (module === 'sales') {
    const { data: openSo } = await db.from('ops_sales_orders').select('product_raw,quantity,dispatched_qty,status').in('status', ['Open', 'Partially Completed']);
    facts.openSalesOrders = (openSo || []).length;
    facts.openCommitmentMt = (openSo || []).reduce((s: number, r: any) => s + Math.max(0, Number(r.quantity || 0) - Number(r.dispatched_qty || 0)), 0);
    const mostConstrained = [...(openSo || [])].sort((a: any, b: any) => (Number(b.quantity || 0) - Number(b.dispatched_qty || 0)) - (Number(a.quantity || 0) - Number(a.dispatched_qty || 0)))[0];
    if (mostConstrained) facts.mostConstrainedProduct = { name: mostConstrained.product_raw, remainingMt: Math.max(0, Number(mostConstrained.quantity || 0) - Number(mostConstrained.dispatched_qty || 0)) };
  } else if (module === 'quality_settlement') {
    // Under 1000 today but a bare select() over the whole table is the same
    // unbounded shape that already broke elsewhere — paged pre-emptively.
    const { data: settlements } = await fetchAllRows<any>((rangeFrom, rangeTo) => db.from('ops_settlements').select('lot_no,inward_date').range(rangeFrom, rangeTo));
    facts.settlementPendingCount = (settlements || []).length;
    const oldestSettlement = [...(settlements || [])].filter((s: any) => s.inward_date).sort((a: any, b: any) => a.inward_date.localeCompare(b.inward_date))[0];
    if (oldestSettlement) facts.oldestPendingSettlement = { lotNo: oldestSettlement.lot_no, daysWaiting: Math.floor((Date.now() - new Date(oldestSettlement.inward_date).getTime()) / 86400000) };
  } else if (module === 'production') {
    const { data: latestSummary } = await db.from('ops_daily_control_summary').select('production_total_qty_mt,production_stock_variance_mt,report_date').order('report_date', { ascending: false }).limit(1).maybeSingle();
    if (latestSummary) {
      facts.productionTotalMt = (latestSummary as any).production_total_qty_mt;
      facts.productionStockVarianceMt = (latestSummary as any).production_stock_variance_mt;
      facts.asOf = (latestSummary as any).report_date;
    }
  }
  return facts;
}

function deterministicInsight(module: PageModule, facts: any): PageInsight {
  const parts: string[] = [];
  if (module === 'supply') {
    parts.push(`${facts.openPoCount} open purchase order(s), ${facts.vehiclesAwaitingWeighment} vehicle(s) awaiting weighment, ${facts.lotsInProgress} lot(s) in progress.`);
    if (facts.oldestOpenPo) parts.push(`Oldest open PO: ${facts.oldestOpenPo.poNo} at ${facts.oldestOpenPo.daysOpen} day(s).`);
    if (facts.longestWaitingGatePass) parts.push(`Gate pass ${facts.longestWaitingGatePass.gatePassNo} has been waiting ${facts.longestWaitingGatePass.daysWaiting} day(s) for weighment.`);
  } else if (module === 'sales') {
    parts.push(`${facts.openSalesOrders} open sale order(s), ${Number(facts.openCommitmentMt || 0).toFixed(1)} MT still committed but not dispatched.`);
    if (facts.mostConstrainedProduct) parts.push(`Most committed: ${facts.mostConstrainedProduct.name} with ${Number(facts.mostConstrainedProduct.remainingMt || 0).toFixed(1)} MT still to dispatch.`);
  } else if (module === 'quality_settlement') {
    parts.push(`${facts.settlementPendingCount} lot(s) awaiting settlement.`);
    if (facts.oldestPendingSettlement) parts.push(`Longest-waiting: lot ${facts.oldestPendingSettlement.lotNo} at ${facts.oldestPendingSettlement.daysWaiting} day(s).`);
  }
  else if (module === 'production') parts.push(facts.asOf ? `As of ${facts.asOf}: production ${Number(facts.productionTotalMt || 0).toFixed(1)} MT, stock variance ${Number(facts.productionStockVarianceMt || 0).toFixed(1)} MT.` : 'No production/stock reconciliation computed yet.');
  parts.push(facts.openExceptionsCount ? `${facts.openExceptionsCount} open exception(s)${facts.criticalCount ? `, ${facts.criticalCount} critical` : ''}.` : 'No open exceptions.');
  return { summary: parts.join(' '), needsAttention: (facts.topExceptions || []).map((e: any) => e.description).slice(0, 3) };
}

/** Per-page "AIX3 Insight" — same discipline as generateOperationsBrief
 * (lib/aix3/brief.ts): facts fetched from already-computed sources first,
 * a deterministic fallback built from those same facts, AIX3 only asked to
 * turn them into readable prose (never to invent a number), and any
 * failure silently returns the fallback. Cached per (module, report_date)
 * in ops_page_insights so a page reload the same day never re-calls AIX3. */
export async function generatePageInsight(module: PageModule, reportDate: string): Promise<PageInsight> {
  const db = supabaseAdmin();
  const facts = await gatherFacts(module);
  const fallback = deterministicInsight(module, facts);
  if (!aix3Enabled()) return fallback;
  try {
    const instructions = `You write a short (2-3 sentence) operational read for the "${module}" area of an agro-processing plant's Operations Intelligence dashboard, from the supplied facts JSON only — never invent a number, name, or event not present in it. Never quote raw system fields verbatim (ids, internal keys). Also return up to 3 short "needs attention" bullets drawn only from the supplied exception descriptions — omit the field entirely if there are none. Return JSON only: {"summary":"...","needsAttention":["..."]}`;
    // Confirmed live: a real call took 18.5s, uncomfortably close to a 20s
    // timeout — matching brief.ts's own 30s budget for a similarly-scoped
    // call instead of a shorter one specific to this file.
    const raw = await aix3Complete({ feature: 'Page Insight', instructions, input: JSON.stringify(facts), timeout: 30000 });
    const parsed = parseAix3Json<PageInsight>(raw);
    if (!parsed || typeof parsed.summary !== 'string') return fallback;
    const insight: PageInsight = { summary: parsed.summary, needsAttention: Array.isArray(parsed.needsAttention) ? parsed.needsAttention.slice(0, 5) : fallback.needsAttention };
    await db.from('ops_page_insights').upsert({ module, report_date: reportDate, insight }, { onConflict: 'module,report_date' });
    return insight;
  } catch {
    return fallback;
  }
}
