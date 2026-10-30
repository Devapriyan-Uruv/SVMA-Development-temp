import { NextResponse } from 'next/server';
import { moduleAuthorization, IMPORT_VIEW_ROLES } from '@/lib/authorize';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { errorMessage, logServerError } from '@/lib/errors';
import { runContractAlerts } from '@/lib/importMaster/notify';

export const runtime = 'nodejs';

/** GET — works out the contract alerts for today and sends each one once per person. The Import pages call this when they open and the daily
 * morning job runs it too (the same no-duplicate pattern as the trade SLA sweep: every insert is idempotent through notifications.dedupe_key). */
export async function GET() {
  try {
    const az = await moduleAuthorization('import', IMPORT_VIEW_ROLES);
    if (!az.ok) return NextResponse.json({ error: az.status === 401 ? 'Authentication required.' : 'Import access is required.' }, { status: az.status });
    return NextResponse.json({ notified: await runContractAlerts(supabaseAdmin()) });
  } catch (e) {
    logServerError('import-contracts/alerts', e);
    return NextResponse.json({ error: errorMessage(e, 'Import alert sweep failed.') }, { status: 500 });
  }
}
