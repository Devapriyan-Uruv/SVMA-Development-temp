import { supabaseAdmin } from '@/lib/supabase/admin';
import { aix3Complete, aix3Enabled, parseAix3Json } from '@/lib/aix3/provider';

export type RecoverySuggestion = {
  candidate: string;
  confidence: number;
  reason: string;
  suggestedSteps: unknown[] | null;
};

/** AIX3's ERP-navigation recovery role (spec section 13): given the labels
 * actually visible on the page a configured path failed on, plus the
 * target report's own catalogue description, suggest the most likely
 * replacement. Deliberately narrow — AIX3 only ever chooses among the
 * labels it was actually shown, never invents a path from nothing, and
 * never touches live navigation itself (the deterministic ERP Navigator
 * does the clicking). A suggestion is stored as a brand-new
 * ops_erp_report_navigation row (status 'DISCOVERED') for a human — or a
 * future automated promotion pass — to test; it never overwrites or
 * auto-activates over the currently active row.
 *
 * Scaffolded but not yet wired into the live push loop (lib/ops/erpSync.ts)
 * — a failed report is simply marked NEEDS_NAVIGATION_REVIEW for now, since
 * there's no real navigation failure yet to learn from. This function is
 * ready for that wiring once navigation paths exist and start failing. */
export async function suggestRecoveryPath(reportCatalogId: string, reportCode: string, reportName: string, erpSection: string, description: string | null, visibleLabels: string[]): Promise<RecoverySuggestion | null> {
  if (!aix3Enabled() || !visibleLabels.length) return null;
  const instructions = 'You help recover ERP report navigation for SVMA\'s Operations Intelligence system. Given the menu/heading/button labels currently visible on an ERP page, and the report AIX3 is trying to reach, find the single most likely matching label. Only choose from the labels actually provided — never invent a label that is not in the list. If nothing plausible matches, say so with low confidence. Return JSON only: {"candidate":"<label from the list, or null>","confidence":0.0-1.0,"reason":"..."}';
  const input = JSON.stringify({ report_code: reportCode, report_name: reportName, section: erpSection, purpose: description, visible_labels: visibleLabels });
  try {
    const raw = await aix3Complete({ feature: 'ERP Navigation Recovery', instructions, input, timeout: 20000 });
    const parsed = parseAix3Json<{ candidate: string | null; confidence: number; reason: string }>(raw);
    if (!parsed || !parsed.candidate || !visibleLabels.includes(parsed.candidate)) return null;
    const confidence = Number.isFinite(parsed.confidence) ? Math.max(0, Math.min(1, parsed.confidence)) : 0;

    const db = supabaseAdmin();
    await db.from('ops_erp_report_navigation').insert({
      report_catalog_id: reportCatalogId,
      navigation_steps: [],
      status: 'DISCOVERED',
      active: false,
      discovery_reason: parsed.reason,
      discovery_confidence: confidence,
    });
    return { candidate: parsed.candidate, confidence, reason: parsed.reason, suggestedSteps: null };
  } catch {
    return null;
  }
}
