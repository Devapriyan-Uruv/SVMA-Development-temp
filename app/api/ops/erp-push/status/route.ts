import { NextRequest, NextResponse } from 'next/server';
import { moduleAuthorization, OPS_ROLES } from '@/lib/authorize';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

/** Live per-report progress + final summary for one sync run — polled by
 * the Data Hub UI while a push is RUNNING, and once on completion for the
 * summary card. */
export async function GET(req: NextRequest) {
  const az = await moduleAuthorization('operations_intelligence', OPS_ROLES);
  if (!az.ok) return NextResponse.json({ error: 'Operations Intelligence access not assigned' }, { status: az.status });
  const syncRunId = req.nextUrl.searchParams.get('syncRunId');
  if (!syncRunId) return NextResponse.json({ error: 'A syncRunId is required.' }, { status: 400 });

  const db = supabaseAdmin();
  const [{ data: run, error: runErr }, { data: reportRuns }] = await Promise.all([
    db.from('ops_erp_sync_runs').select('*').eq('id', syncRunId).maybeSingle(),
    db.from('ops_erp_sync_report_runs').select('*,ops_erp_report_catalog(report_code,report_name,erp_section,processing_priority)').eq('sync_run_id', syncRunId).order('created_at'),
  ]);
  if (runErr || !run) return NextResponse.json({ error: 'Sync run not found.' }, { status: 404 });
  return NextResponse.json({ run, reportRuns: reportRuns || [] });
}
