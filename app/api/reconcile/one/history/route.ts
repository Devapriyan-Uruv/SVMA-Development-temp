import { moduleAuthorization, FINANCE_ROLES } from '@/lib/authorize';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { fetchAllRows } from '@/lib/supabase/fetchAll';
import { STATUS_PRIORITY, type MasterRow, type ReconStatus } from '@/lib/oneReconciliation/master';
import { errorMessage, logServerError } from '@/lib/errors';

export const runtime = 'nodejs';

/** The consolidated, ever-growing ledger: every date's reconciliation stays
 * in this view permanently (nothing is ever cleared) — running this again
 * for a NEW date adds that date's rows, it never replaces what's already
 * here. Re-running the SAME date again (a genuine correction, e.g. a
 * re-uploaded Tally Day Book) supersedes only that one date's prior rows
 * with the newer run's — the old run stays in the database for audit, it
 * just isn't shown once a newer run for that same date exists. */
export async function GET(req: NextRequest) {
  try {
    const az = await moduleAuthorization('finance_transaction', FINANCE_ROLES);
    if (!az.ok) return NextResponse.json({ error: az.status === 401 ? 'Not authenticated' : 'Finance access not assigned' }, { status: az.status });
    const db = supabaseAdmin();
    const from = req.nextUrl.searchParams.get('from') || '';
    const to = req.nextUrl.searchParams.get('to') || '';

    const { data: runs, error: runErr } = await fetchAllRows<any>((f, t) => db.from('one_reconciliation_runs').select('id,run_code,reconciliation_date,created_at').order('created_at', { ascending: false }).range(f, t));
    if (runErr) throw runErr;
    if (!runs.length) return NextResponse.json({ rows: [], runId: 'LEDGER', reconciliationDate: '', understanding: [], definitions: [], warnings: ['No reconciliation has been run yet.'], summary: { total: 0, byStatus: {}, byType: {}, productNotFound: 0 } });

    // A run's OWN reconciliation_date column is single-day only (null for a
    // combined multi-day run — see persist.ts) so it can no longer be what
    // "wins per date" is computed from. The real per-transaction dates are
    // read once, cheaply (two columns, every run), and the winner for each
    // calendar date is whichever run touching that date was created most
    // recently — this is what makes BOTH a plain single-day run AND a
    // combined multi-day run supersede correctly, date by date, however
    // their date coverage overlaps.
    const { data: dateRows, error: dateErr } = await fetchAllRows<any>((f, t) => db.from('one_reconciliation_transactions').select('run_id,transaction_date').range(f, t));
    if (dateErr) throw dateErr;
    const datesByRun = new Map<string, Set<string>>();
    for (const t of dateRows) { if (!t.transaction_date) continue; (datesByRun.get(t.run_id) || datesByRun.set(t.run_id, new Set()).get(t.run_id)!).add(t.transaction_date); }

    const runById = new Map(runs.map((r: any) => [r.id, r]));
    // `runs` is already newest-first (ordered by created_at above) — walking
    // it in that order and only ever claiming a date the first time it's
    // seen IS "most recent run wins" for that date.
    const winnerRunByDate = new Map<string, string>();
    for (const r of runs) { const dates = datesByRun.get(r.id); if (!dates) continue; for (const d of dates) if (!winnerRunByDate.has(d)) winnerRunByDate.set(d, r.id); }

    let winningDates = [...winnerRunByDate.keys()];
    if (from) winningDates = winningDates.filter(d => d >= from);
    if (to) winningDates = winningDates.filter(d => d <= to);
    winningDates.sort();
    const noDateRuns = runs.filter((r: any) => !datesByRun.has(r.id));
    let totalRunDatePairs = 0; for (const dates of datesByRun.values()) totalRunDatePairs += dates.size;
    const supersededCount = totalRunDatePairs - winnerRunByDate.size;

    if (!winningDates.length) return NextResponse.json({ rows: [], runId: 'LEDGER', reconciliationDate: '', understanding: [], definitions: [], warnings: ['No reconciliation has been run yet.'], summary: { total: 0, byStatus: {}, byType: {}, productNotFound: 0 } });

    const winnerRunIds = [...new Set(winningDates.map(d => winnerRunByDate.get(d)!))];
    const { data: txRowsRaw, error: txErr } = await fetchAllRows<any>((f, t) => db.from('one_reconciliation_transactions').select('run_id,recon_id,transaction_type,transaction_date,primary_status,statuses,master,audit').in('run_id', winnerRunIds).order('transaction_date', { ascending: true }).range(f, t));
    if (txErr) throw txErr;
    // A run can win SOME of its dates and lose others to a newer run that
    // re-covers only part of its range — filter down to exactly the
    // (run, date) pairs that actually won, not every row of a winning run.
    const winningDateSet = new Set(winningDates);
    const txRows = txRowsRaw.filter((t: any) => t.transaction_date && winningDateSet.has(t.transaction_date) && winnerRunByDate.get(t.transaction_date) === t.run_id);

    const rows: MasterRow[] = txRows.map((t: any) => ({
      reconId: t.recon_id, runId: runById.get(t.run_id)?.run_code || t.run_id, transactionType: t.transaction_type,
      primaryStatus: t.primary_status, statuses: t.statuses as ReconStatus[], v: t.master,
      // The stored ProductMatch object isn't duplicated in this table (it
      // lives inside `master`/`audit` already) — nothing in the UI reads
      // row.product directly, so a minimal placeholder is enough here.
      product: { raw: '', normalized: '', masterProductId: null, masterProductName: null, masterCategory: null, masterProductType: null, matchMethod: 'not_found', matchConfidence: 0, aiSuggestion: null },
      audit: t.audit || [],
    }));

    const byStatus: Record<string, number> = {}, byType: Record<string, number> = {};
    for (const s of STATUS_PRIORITY) byStatus[s] = rows.filter(r => r.statuses.includes(s)).length;
    for (const r of rows) byType[r.transactionType] = (byType[r.transactionType] || 0) + 1;

    const spanFrom = winningDates[0], spanTo = winningDates[winningDates.length - 1];
    const warnings: string[] = [];
    if (supersededCount > 0) warnings.push(`${supersededCount} date(s) covered by an older run that was re-run are kept in the database for audit but not shown here — only the most recent run per date counts.`);
    if (noDateRuns.length) warnings.push(`${noDateRuns.length} run(s) had no reconciliation dates at all and are excluded from this ledger.`);
    return NextResponse.json({
      rows, runId: 'LEDGER', reconciliationDate: spanFrom === spanTo ? spanFrom : `${spanFrom} to ${spanTo}`,
      understanding: [], warnings,
      definitions: [
        'Consolidated Ledger: every date reconciled so far, one row per transaction, growing day over day — running a new date (or a combined multi-day run) adds its rows here, it never replaces an earlier date\'s rows.',
        'Re-running a date that was already covered replaces only that date\'s rows with the newer run\'s, date by date — even if the older and newer runs each covered a different range of days (the superseded rows stay in the database, just not shown).',
      ],
      dates: winningDates.map(d => ({ date: d, runCode: runById.get(winnerRunByDate.get(d)!)?.run_code || '', transactions: rows.filter(x => x.v.date === d).length })),
      supersededCount,
      summary: { total: rows.length, byStatus, byType, productNotFound: rows.filter(r => String(r.v.productMethod) === 'not_found').length },
    });
  } catch (error) {
    logServerError('reconcile/one/history', error);
    return NextResponse.json({ error: errorMessage(error, 'Unable to load the consolidated ledger.') }, { status: 500 });
  }
}
