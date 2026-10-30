import { authorization } from '@/lib/authorize';
import { NextRequest, NextResponse } from 'next/server';
import { callReport, MtReportError } from '@/lib/ops/mtreport/client';
import { errorMessage, logServerError } from '@/lib/errors';

export const runtime = 'nodejs';
export const maxDuration = 120;

const REPORTS = new Set(['purchase-order', 'purchase-order-pending', 'inward-payment']);
const kind = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

/** Super-admin only: runs one ERP report with a filter and describes what comes back (row count, fields, a few sample rows) so the
 * data can be mapped before anything is stored. Reads only; tokens and the Client ID never leave the server. */
export async function POST(req: NextRequest) {
  try {
    const az = await authorization(['super_admin']);
    if (!az.ok) return NextResponse.json({ error: az.status === 401 ? 'Not authenticated' : 'Super admin only' }, { status: az.status });
    const b = await req.json().catch(() => null) as { report?: string; filter?: Record<string, unknown> } | null;
    if (!b?.report || !REPORTS.has(b.report)) return NextResponse.json({ error: `Choose a report: ${[...REPORTS].join(', ')}.` }, { status: 400 });
    const rows = await callReport<Record<string, unknown>>(b.report, b.filter || {});
    const fields: Record<string, { types: string[]; filled: number; example: unknown }> = {};
    for (const r of rows) for (const [k, v] of Object.entries(r)) { const f = fields[k] || (fields[k] = { types: [], filled: 0, example: null }); const t = kind(v); if (!f.types.includes(t)) f.types.push(t); if (v !== null && v !== '') { f.filled++; if (f.example === null) f.example = v; } }
    return NextResponse.json({ report: b.report, filter: b.filter || {}, rowCount: rows.length, fields, sample: rows.slice(0, 5) });
  } catch (e) {
    if (e instanceof MtReportError) return NextResponse.json({ error: e.message, code: e.code, fieldErrors: e.fieldErrors }, { status: e.status >= 400 && e.status < 600 ? e.status : 502 });
    logServerError('ops/mtreport/probe', e);
    return NextResponse.json({ error: errorMessage(e, 'Unable to read the ERP report.') }, { status: 500 });
  }
}
