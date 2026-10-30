import { NextRequest, NextResponse } from 'next/server';
import { moduleAuthorization, OPS_ROLES } from '@/lib/authorize';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { generatePageInsight, type PageModule } from '@/lib/aix3/pageInsight';
import { istTodayDate } from '@/lib/time';
import { errorMessage, logServerError } from '@/lib/errors';

export const runtime = 'nodejs';

const VALID_MODULES: PageModule[] = ['supply', 'production', 'quality_settlement', 'sales', 'exceptions'];

/** Per-page "AIX3 Insight" panel — same cached-per-day discipline as
 * /api/ops/brief: never a live AIX3 call per page load, only on the first
 * load of a new day for that module. */
export async function GET(req: NextRequest) {
  try {
    const az = await moduleAuthorization('operations_intelligence', OPS_ROLES);
    if (!az.ok) return NextResponse.json({ error: az.status === 401 ? 'Not authenticated' : 'Operations Intelligence access not assigned' }, { status: az.status });
    const module = req.nextUrl.searchParams.get('module') as PageModule;
    if (!VALID_MODULES.includes(module)) return NextResponse.json({ error: 'Unknown insight module.' }, { status: 400 });
    const db = supabaseAdmin();
    const reportDate = istTodayDate();
    const { data: cached } = await db.from('ops_page_insights').select('insight').eq('module', module).eq('report_date', reportDate).maybeSingle();
    if (cached) return NextResponse.json((cached as any).insight);
    const insight = await generatePageInsight(module, reportDate);
    return NextResponse.json(insight);
  } catch (e) {
    logServerError('ops/insight', e);
    return NextResponse.json({ error: errorMessage(e, 'Unable to generate insight.') }, { status: 500 });
  }
}
