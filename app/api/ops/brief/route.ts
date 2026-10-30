import {NextRequest,NextResponse} from 'next/server';
import {moduleAuthorization,OPS_ROLES} from '@/lib/authorize';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {generateOperationsBrief} from '@/lib/aix3/brief';
import {errorMessage,logServerError} from '@/lib/errors';

export const runtime = 'nodejs';

/** "Today's Operations Story" for the Management Control Tower — generated
 * from ops_daily_control_summary + ops_exceptions only (see
 * lib/aix3/brief.ts), never a live AIX3 call per page load: cached by
 * report_date in ops_management_briefs when AIX3 succeeds, so repeat loads
 * of the same date are cheap. */
export async function GET(req: NextRequest) {
  try {
    const az = await moduleAuthorization('operations_intelligence', OPS_ROLES);
    if (!az.ok) return NextResponse.json({ error: az.status === 401 ? 'Not authenticated' : 'Operations Intelligence access not assigned' }, { status: az.status });
    const db = supabaseAdmin();
    let date = req.nextUrl.searchParams.get('date');
    if (!date) {
      const { data: latest } = await db.from('ops_daily_control_summary').select('report_date').order('report_date', { ascending: false }).limit(1).maybeSingle();
      date = (latest as any)?.report_date || new Date().toISOString().slice(0, 10);
    }
    const { data: cached } = await db.from('ops_management_briefs').select('brief').eq('report_date', date).maybeSingle();
    if (cached) return NextResponse.json({ reportDate: date, brief: (cached as any).brief });
    const brief = await generateOperationsBrief(date!);
    return NextResponse.json({ reportDate: date, brief });
  } catch (e) {
    logServerError('ops/brief', e);
    return NextResponse.json({ error: errorMessage(e, 'Unable to generate the operations brief.') }, { status: 500 });
  }
}
