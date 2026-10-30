import { NextResponse } from 'next/server';
import { moduleAuthorization, moduleEditAuthorization, IMPORT_VIEW_ROLES, IMPORT_EDIT_ROLES } from '@/lib/authorize';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { errorMessage, logServerError } from '@/lib/errors';
import { buildImportStatus } from '@/lib/importMaster/status';

export const runtime = 'nodejs';
/** GET — what is awaiting review, what is empty on the open import records, and which date alerts are due: the page the morning status links to. */
export async function GET() {
  try {
    const az = await moduleAuthorization('import', IMPORT_VIEW_ROLES);
    if (!az.ok) return NextResponse.json({ error: az.status === 401 ? 'Authentication required.' : 'Import access is required.' }, { status: az.status });
    const [status, ed] = await Promise.all([buildImportStatus(supabaseAdmin()), moduleEditAuthorization('import', IMPORT_EDIT_ROLES)]);
    return NextResponse.json({ ...status, canEdit: ed.ok });
  } catch (e) {
    logServerError('import/status', e);
    return NextResponse.json({ error: errorMessage(e, 'Unable to load the Import status.') }, { status: 500 });
  }
}
