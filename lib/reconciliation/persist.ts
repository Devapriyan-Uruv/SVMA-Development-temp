import { supabaseAdmin } from '@/lib/supabase/admin';
import type { EngineResult, TransactionResult } from './engine';
import { upsertDocumentFamilyObservations } from './profile';
import type { FamilyObservation } from './documentFamily';

/** Persist one run's summary + per-transaction traceability + exception
 * rows + learned document-family observations. Best-effort — a persistence
 * failure never blocks returning results to the user (same discipline as
 * the existing /api/reconcile/transaction route), but is reported as a
 * warning so it's never silently swallowed. */
export async function persistRun(result: EngineResult, familyObservations: FamilyObservation[], runByUserId: string | null, profileVersion: number): Promise<{ runId: string | null; warning: string | null }> {
  const db = supabaseAdmin();
  try {
    const saved = await db.from('reconciliation_runs').insert({
      reconciliation_date: result.reconciliationDate,
      status: 'completed',
      run_by: runByUserId,
      reconciliation_type: 'ai_transaction',
      summary: { ...result.summary, sourceStats: result.sourceStats, warnings: result.warnings, rulesVersion: 'ai_engine_1', downloadReport: { ...result, rulesVersion: 'ai_engine_1' } },
      completed_at: new Date().toISOString(),
    }).select('id').single();
    if (saved.error) throw saved.error;
    const runId = saved.data?.id as string;

    const rows = result.transactions.map((t: TransactionResult) => ({
      run_id: runId, weighment_ref: t.weighBridgeRef || t.weighmentId, weighment_date: t.date,
      vehicle_raw: t.vehicle, vehicle_normalized: t.vehicle.toUpperCase().replace(/[^A-Z0-9]/g, ''),
      party_raw: t.party, party_normalized: t.party.toUpperCase(),
      material_raw: t.material, material_normalized: t.material.toUpperCase(), material_family: t.materialFamily,
      net_weight: t.netWeight, category: t.category, category_reason: t.categoryReason,
      gate_selected: t.gate ? { id: t.gate.id, gp: t.gate.gp, party: t.gate.party, order: t.gate.order, direction: t.gate.direction, date: t.gate.date } : null,
      gate_candidates: t.gateCandidatesAll,
      tally_selected: t.tallySelected.map(v => ({ id: v.id, vchNo: v.vchNo, orderRef: v.orderRef, sheetRole: v.sheetRole, date: v.date })),
      tally_candidates: t.tallyCandidatesAll,
      consolidated_with: t.consolidatedWith,
      deterministic_score: t.gateScore, ai_confidence: t.aiSource === 'AI' ? t.confidence : null, final_confidence: t.confidence,
      status: t.status, exception_code: t.exceptionCode, evidence: [...t.gateEvidence, ...t.tallyEvidence],
      ai_explanation: t.aiSource === 'AI' ? t.comments : null,
      source_refs: { weighment: t.weighmentSource },
      model_used: t.aiSource === 'AI' ? (process.env.OPENAI_MODEL || 'gpt-5-mini') : null,
      profile_version: profileVersion,
    }));
    if (rows.length) { const ins = await db.from('reconciliation_transactions').insert(rows); if (ins.error) throw ins.error; }

    const exceptionRows = result.transactions.filter(t => t.status === 'Not Found' || t.status === 'Review' || t.status === 'Partial').map(t => ({
      run_id: runId, exception_type: t.exceptionCode || 'REVIEW', severity: t.status === 'Not Found' ? 'warning' : 'info',
      vehicle_no: t.vehicle, party_name: t.party, reference_no: t.weighBridgeRef, description: t.comments,
    }));
    if (exceptionRows.length) await db.from('reconciliation_exceptions').insert(exceptionRows);

    await upsertDocumentFamilyObservations(familyObservations);
    return { runId, warning: null };
  } catch (e) {
    return { runId: null, warning: 'Results and Excel export are ready, but this run could not be saved to history/traceability tables. Run sql/038_ai_reconciliation_engine.sql if it has not been applied yet.' };
  }
}
