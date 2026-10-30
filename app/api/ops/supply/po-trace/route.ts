import { NextRequest, NextResponse } from 'next/server';
import { moduleAuthorization, OPS_ROLES } from '@/lib/authorize';
import { getPoTrace } from '@/lib/aix3/tools';
import { errorMessage, logServerError } from '@/lib/errors';

export const runtime = 'nodejs';

/** Full PO → Gate In → Weighment → Lot → QC → Settlement → Feeding →
 * Payment trace for the Supply page's "Trace" drawer. See getPoTrace in
 * lib/aix3/tools.ts for the join logic. */
export async function GET(req: NextRequest) {
  try {
    const az = await moduleAuthorization('operations_intelligence', OPS_ROLES);
    if (!az.ok) return NextResponse.json({ error: az.status === 401 ? 'Not authenticated' : 'Operations Intelligence access not assigned' }, { status: az.status });
    const poNo = req.nextUrl.searchParams.get('poNo');
    if (!poNo) return NextResponse.json({ error: 'poNo is required.' }, { status: 400 });
    const trace = await getPoTrace(poNo);
    return NextResponse.json(trace);
  } catch (e) {
    logServerError('ops/supply/po-trace', e);
    return NextResponse.json({ error: errorMessage(e, 'Unable to trace this purchase order.') }, { status: 500 });
  }
}
