import { moduleAuthorization, FINANCE_ROLES } from '@/lib/authorize';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { errorMessage, logServerError } from '@/lib/errors';
import { buildView } from '@/lib/outstanding/view';

export const runtime = 'nodejs';
export const maxDuration = 60;

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown, n = 200) => String(v ?? '').slice(0, n);

/** Saves a Tally Outstandings export (read in the browser) and returns the refreshed screen data. The newest upload per side
 * replaces the figures worked out from the Day Book for that side. */
export async function POST(req: NextRequest) {
  try {
    const az = await moduleAuthorization('finance_transaction', FINANCE_ROLES);
    if (!az.ok) return NextResponse.json({ error: az.status === 401 ? 'Not authenticated' : 'Finance access not assigned' }, { status: az.status });
    const body = await req.json().catch(() => null) as { fileName?: string; report?: { kind?: string; side?: string; asOf?: string; rows?: any[] } } | null;
    const r = body?.report;
    if (!r || (r.kind !== 'bills' && r.kind !== 'summary') || (r.side !== 'creditor' && r.side !== 'debtor') || !isDate(r.asOf) || !Array.isArray(r.rows) || !r.rows.length) return NextResponse.json({ error: 'The Tally report is incomplete. Please upload the file again.' }, { status: 400 });
    if (r.rows.length > 50000) return NextResponse.json({ error: 'The Tally report is too large.' }, { status: 413 });
    const rows = r.kind === 'bills'
      ? r.rows.map(x => ({ party: str(x.party), ref: str(x.ref, 120), date: isDate(x.date) ? x.date : r.asOf!, opening: num(x.opening), pending: num(x.pending), dueOn: isDate(x.dueOn) ? x.dueOn : '', overdueDays: num(x.overdueDays) })).filter(x => x.party)
      : r.rows.map(x => ({ party: str(x.party), balance: num(x.balance) })).filter(x => x.party);
    const { error } = await supabaseAdmin().from('outstanding_tally_reports').insert({ side: r.side, kind: r.kind, as_of: r.asOf, file_name: str(body?.fileName, 200) || null, row_count: rows.length, rows, created_by: az.user?.id ?? null });
    if (error) throw error;
    return NextResponse.json(await buildView());
  } catch (error) {
    logServerError('finance/outstanding/tally:save', error);
    return NextResponse.json({ error: errorMessage(error, 'Unable to save the Tally report.') }, { status: 500 });
  }
}
