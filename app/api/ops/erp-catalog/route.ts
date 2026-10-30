import { NextRequest, NextResponse } from 'next/server';
import { moduleAuthorization, OPS_ROLES, OPS_ERP_PUSH_ROLES } from '@/lib/authorize';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { errorMessage, logServerError } from '@/lib/errors';

export const runtime = 'nodejs';

const PATCHABLE = new Set(['enabled', 'is_required', 'auto_download']);

/** Admin ERP Configuration screen: the report catalogue plus each report's
 * currently-active navigation status, for the table in spec section 38. */
export async function GET() {
  const az = await moduleAuthorization('operations_intelligence', OPS_ROLES);
  if (!az.ok) return NextResponse.json({ error: 'Operations Intelligence access not assigned' }, { status: az.status });
  const db = supabaseAdmin();
  const { data: allRows, error } = await db.from('ops_erp_report_catalog').select('*,ops_erp_report_navigation(id,status,active,navigation_steps,date_selector_config,expected_page_heading,verified_at,updated_at)').order('processing_priority');
  if (error) return NextResponse.json({ error: 'Unable to load the ERP report catalogue.' }, { status: 500 });
  const flatten = (r: any) => ({ ...r, ops_erp_report_navigation: (r.ops_erp_report_navigation || []).find((n: any) => n.active !== false) || (r.ops_erp_report_navigation || [])[0] || null });
  const login = (allRows || []).find((r: any) => r.report_code === '__LOGIN__');
  const rows = (allRows || []).filter((r: any) => r.report_code !== '__LOGIN__').map(flatten);
  return NextResponse.json({ catalog: rows, login: login ? flatten(login) : null });
}

/** Enable/disable, required/optional, auto-fetch toggles — never the
 * report_code/name/business fields (those come from the real ERP export
 * structure, not something to hand-edit). */
export async function PATCH(req: NextRequest) {
  try {
    const az = await moduleAuthorization('operations_intelligence', OPS_ROLES);
    if (!az.ok) return NextResponse.json({ error: az.status === 401 ? 'Not authenticated' : 'Operations Intelligence access not assigned' }, { status: az.status });
    if (!OPS_ERP_PUSH_ROLES.some(r => az.roles?.includes(r))) return NextResponse.json({ error: 'Only Operations admins can change the ERP catalogue.' }, { status: 403 });

    const body = await req.json();
    if (!body.id) return NextResponse.json({ error: 'A catalog id is required.' }, { status: 400 });
    const patch: Record<string, unknown> = {};
    for (const key of Object.keys(body)) if (PATCHABLE.has(key)) patch[key] = body[key];
    if (!Object.keys(patch).length) return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
    patch.updated_at = new Date().toISOString();

    const db = supabaseAdmin();
    const { data, error } = await db.from('ops_erp_report_catalog').update(patch).eq('id', body.id).select('*').single();
    if (error) throw error;
    return NextResponse.json({ catalog: data });
  } catch (e) {
    logServerError('ops/erp-catalog', e);
    return NextResponse.json({ error: errorMessage(e, 'Unable to update the catalogue.') }, { status: 500 });
  }
}
