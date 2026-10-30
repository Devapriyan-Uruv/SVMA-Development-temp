import { randomUUID } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { OneReconResult } from './master';

/** Writes one run to one_reconciliation_runs + one row per transaction to
 * one_reconciliation_transactions (separate from the existing
 * reconciliation_runs/reconciliation_transactions). The whole master row and
 * its audit trail are stored as jsonb; the handful of columns used for
 * filtering are duplicated as real columns. Best-effort: a persistence
 * failure never blocks returning the computed result. */
export async function persistOneRun(result: OneReconResult, runBy: string | null): Promise<{ savedRunId: string | null; error: string | null }> {
  const db = supabaseAdmin();
  const id = randomUUID();
  try {
    // reconciliation_date is a single DB `date` column — a combined multi-day
    // run's result.reconciliationDate is a display span ("2026-09-01 to
    // 2026-09-27"), not a real date, so it's stored as null here rather than
    // failing the insert; every transaction's own transaction_date below is
    // unaffected and is what the Consolidated Ledger actually keys off.
    const singleDate = /^\d{4}-\d{2}-\d{2}$/.test(String(result.reconciliationDate)) ? result.reconciliationDate : null;
    const { error: runErr } = await db.from('one_reconciliation_runs').insert({
      id, run_code: result.runId, reconciliation_date: singleDate, status: 'completed', run_by: runBy,
      summary: result.summary, warnings: result.warnings, understanding: result.understanding, completed_at: new Date().toISOString(),
    });
    if (runErr) return { savedRunId: null, error: `Run could not be saved: ${runErr.message}` };
    const rows = result.rows.map(r => ({
      run_id: id, recon_id: r.reconId, transaction_type: r.transactionType, transaction_date: /^\d{4}-\d{2}-\d{2}$/.test(String(r.v.date)) ? r.v.date : null,
      primary_status: r.primaryStatus, statuses: r.statuses,
      vehicle_no: String(r.v.vehicle), party_name: String(r.v.party), material_raw: String(r.v.material),
      master_product_id: r.product.masterProductId, lot_no: r.v.lot === 'Not Found' || r.v.lot === 'N/A' ? null : String(r.v.lot),
      gate_pass_no: r.v.gatePass === 'Not Found' ? null : String(r.v.gatePass), master: r.v, audit: r.audit,
    }));
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await db.from('one_reconciliation_transactions').insert(rows.slice(i, i + 200));
      if (error) return { savedRunId: id, error: `Run saved but transactions failed to save: ${error.message}` };
    }
    return { savedRunId: id, error: null };
  } catch (e) {
    return { savedRunId: null, error: e instanceof Error ? e.message : 'Could not save the run.' };
  }
}
