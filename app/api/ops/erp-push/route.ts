import { NextRequest, NextResponse } from 'next/server';
import { moduleAuthorization, moduleEditAuthorization, OPS_ROLES, OPS_ERP_PUSH_ROLES } from '@/lib/authorize';
import { currentUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { errorMessage, logServerError } from '@/lib/errors';
import { runDailyErpPush } from '@/lib/ops/erpSync';
import { istYesterdayDate } from '@/lib/time';

export const runtime = 'nodejs';

/** Catalogue summary for the Data Hub's "AIX3 ERP DATA PUSH" card —
 * required/optional counts and the last successful push, so the card can
 * render before anyone clicks anything. */
export async function GET() {
  const az = await moduleAuthorization('operations_intelligence', OPS_ROLES);
  if (!az.ok) return NextResponse.json({ error: 'Operations Intelligence access not assigned' }, { status: az.status });
  const db = supabaseAdmin();
  const [{ data: catalog }, { data: lastSuccess }] = await Promise.all([
    db.from('ops_erp_report_catalog').select('id,is_required').eq('enabled', true).neq('report_code', '__LOGIN__'),
    db.from('ops_erp_sync_runs').select('report_date,completed_at').in('status', ['COMPLETED', 'COMPLETED_WITH_EXCEPTIONS']).order('completed_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  // A report only downloads in a push once its ERP navigation is VERIFIED;
  // with none verified the push can't fetch anything, and the card says so
  // instead of letting someone click it expecting their uploaded files to load.
  const ids = (catalog || []).map((r: any) => r.id);
  const { data: verified } = ids.length ? await db.from('ops_erp_report_navigation').select('report_catalog_id').in('report_catalog_id', ids).eq('active', true).eq('status', 'VERIFIED') : { data: [] as any[] };
  const required = (catalog || []).filter((r: any) => r.is_required).length;
  const optional = (catalog || []).length - required;
  return NextResponse.json({
    dataDate: istYesterdayDate(),
    requiredReports: required,
    optionalReports: optional,
    verifiedReports: new Set((verified || []).map((n: any) => n.report_catalog_id)).size,
    lastSuccessfulPush: lastSuccess ? { reportDate: (lastSuccess as any).report_date, completedAt: (lastSuccess as any).completed_at } : null,
  });
}

/** Triggers a push. Returns the sync_run_id immediately — the actual work
 * runs in the background (see lib/ops/erpSync.ts's doc comment on why). */
export async function POST(req: NextRequest) {
  try {
    const az = await moduleAuthorization('operations_intelligence', OPS_ROLES);
    if (!az.ok) return NextResponse.json({ error: az.status === 401 ? 'Not authenticated' : 'Operations Intelligence access not assigned' }, { status: az.status });
    // Triggering a push needs Edit (not just View) on Operations Intelligence
    // — granted per-user from User Management, same as any other module
    // access — rather than a separate hard-coded admin-only role list.
    const editAz = await moduleEditAuthorization('operations_intelligence', OPS_ERP_PUSH_ROLES);
    if (!editAz.ok) return NextResponse.json({ error: 'You have View access to Operations Intelligence, but triggering an ERP push needs Edit access. Ask an admin to grant Edit access on the Operations Intelligence module.' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const reportDate = typeof body.reportDate === 'string' && body.reportDate ? body.reportDate : istYesterdayDate();
    const user = await currentUser();
    const syncRunId = await runDailyErpPush(reportDate, user?.id || '');
    return NextResponse.json({ syncRunId, reportDate });
  } catch (e) {
    logServerError('ops/erp-push', e);
    return NextResponse.json({ error: errorMessage(e, 'Could not start the ERP push.') }, { status: 500 });
  }
}
