import { moduleAuthorization, SOLVENT_MANAGEMENT_ROLES, QUALITY_MANAGEMENT_ROLES } from '@/lib/authorize';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { errorMessage, logServerError } from '@/lib/errors';
import { resolveParameterMetadata } from '@/lib/parameterMetadata';

// Historical deviations may reference retired parameters. Resolve metadata
// from the active master first, then parameter_master_archive, without relying
// on a PostgREST FK relationship to parameter_master.
export async function GET(req: NextRequest) {
  try {
    const scope = req.nextUrl.searchParams.get('scope') === 'quality' ? 'quality' : 'solvent';
    const az = scope === 'quality'
      ? await moduleAuthorization('quality_management', QUALITY_MANAGEMENT_ROLES)
      : await moduleAuthorization('solvent_management', SOLVENT_MANAGEMENT_ROLES);

    if (!az.ok) {
      return NextResponse.json(
        { error: az.status === 401 ? 'Not authenticated' : 'Management access not assigned' },
        { status: az.status },
      );
    }

    const db = supabaseAdmin();
    const from = req.nextUrl.searchParams.get('from');
    const to = req.nextUrl.searchParams.get('to');
    const severity = req.nextUrl.searchParams.get('severity');
    const section = req.nextUrl.searchParams.get('section');

    let q = db.from('deviations')
      .select('*,shift_sessions(operational_date,scope,shift_master(name)),parameter_entries(product_code,slot_start,entered_by,profiles!parameter_entries_entered_by_fkey(full_name,email))')
      .order('created_at', { ascending: false })
      .limit(500);

    if (from) q = q.gte('created_at', `${from}T00:00:00`);
    if (to) q = q.lte('created_at', `${to}T23:59:59`);
    if (severity) q = q.eq('severity', severity);

    const { data, error } = await q;
    if (error) throw error;

    const rows = data || [];
    const metadata = await resolveParameterMetadata(
      db,
      rows.map((row: any) => row.parameter_id),
    );

    const modules = scope === 'quality' ? ['quality'] : ['solvent', 'boiler'];
    const deviations = rows
      .map((row: any) => ({
        ...row,
        parameter_master: metadata.get(Number(row.parameter_id)) || null,
      }))
      .filter((row: any) =>
        modules.includes(String(row.parameter_master?.parameter_sections?.module)) &&
        (!section || row.parameter_master?.parameter_sections?.name === section),
      );

    return NextResponse.json({ deviations });
  } catch (e) {
    logServerError('deviations', e);
    return NextResponse.json(
      { error: errorMessage(e, 'Unable to load deviations') },
      { status: 500 },
    );
  }
}
