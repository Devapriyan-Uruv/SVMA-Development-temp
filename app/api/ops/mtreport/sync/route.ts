import { moduleAuthorization, OPS_ROLES } from '@/lib/authorize';
import { NextRequest, NextResponse } from 'next/server';
import { runErpApiSync } from '@/lib/ops/mtreport/sync';
import { MtReportError } from '@/lib/ops/mtreport/client';
import { errorMessage, logServerError } from '@/lib/errors';

export const runtime = 'nodejs';
export const maxDuration = 300;

/** Pulls the ERP Report API into the erp_api_* tables now. Allowed for Operations users ("Sync now"), or for an outside timer that
 * sends the shared secret in x-sweep-secret (the same secret the push sweep uses). */
export async function POST(req: NextRequest) {
  try {
    const secret = process.env.PUSH_SWEEP_SECRET, viaSecret = !!secret && req.headers.get('x-sweep-secret') === secret;
    if (!viaSecret) {
      const az = await moduleAuthorization('operations_intelligence', OPS_ROLES);
      if (!az.ok) return NextResponse.json({ error: az.status === 401 ? 'Not authenticated' : 'Operations Intelligence access not assigned' }, { status: az.status });
    }
    return NextResponse.json(await runErpApiSync(viaSecret ? 'schedule' : 'manual'));
  } catch (e) {
    if (e instanceof MtReportError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status >= 400 && e.status < 600 ? e.status : 502 });
    logServerError('ops/mtreport/sync', e);
    return NextResponse.json({ error: errorMessage(e, 'Unable to sync the ERP report data.') }, { status: 500 });
  }
}
