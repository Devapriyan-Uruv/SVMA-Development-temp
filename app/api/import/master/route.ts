import { NextResponse } from 'next/server';
import { moduleAuthorization, IMPORT_VIEW_ROLES } from '@/lib/authorize';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { errorMessage, logServerError } from '@/lib/errors';
import { MASTER, masterRow, missingFields, STAGE_LABEL, type Stage } from '@/lib/importMaster/master';
import { istToday } from '@/lib/importMaster/status';

export const runtime = 'nodejs';
/** GET — the open import records in the Import Master layout (49 columns, one row per invoice / shipment) and what is still empty on each. "Open" is anything not closed. */
export async function GET() {
  try {
    const az = await moduleAuthorization('import', IMPORT_VIEW_ROLES);
    if (!az.ok) return NextResponse.json({ error: az.status === 401 ? 'Authentication required.' : 'Import access is required.' }, { status: az.status });
    const db = supabaseAdmin(), today = istToday();
    const { data, error } = await db.from('import_entries').select('*,trade_parties(name,country),trade_commodities(*)').neq('status', 'closed').order('created_at');
    if (error) throw error;
    const rows = (data || []).map((e: any, i: number) => ({ id: e.id, refCode: e.ref_code, cells: masterRow(e, i + 1, today), missing: missingFields(e, today).map(m => ({ ...m, stageLabel: STAGE_LABEL[m.stage as Stage] })) }));
    return NextResponse.json({ today, columns: MASTER.map(m => ({ no: m.no, label: m.label, kind: m.kind })), rows });
  } catch (e) {
    logServerError('import/master', e);
    return NextResponse.json({ error: errorMessage(e, 'Unable to build the Import Master report.') }, { status: 500 });
  }
}
