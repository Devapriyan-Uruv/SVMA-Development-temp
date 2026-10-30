import { moduleAuthorization, FINANCE_ROLES } from '@/lib/authorize';
import { NextRequest, NextResponse } from 'next/server';
import { gunzipSync } from 'zlib';
import { buildOneReconWorkbook } from '@/lib/oneReconciliation/export';
import type { OneReconResult } from '@/lib/oneReconciliation/master';
import { errorMessage, logServerError } from '@/lib/errors';

export const runtime = 'nodejs';
export const maxDuration = 120;

/** Exports the exact dataset the screen is showing — no re-reconciliation. */
export async function POST(req: NextRequest) {
  try {
    const az = await moduleAuthorization('finance_transaction', FINANCE_ROLES);
    if (!az.ok) return NextResponse.json({ error: az.status === 401 ? 'Not authenticated' : 'Finance access not assigned' }, { status: az.status });
    // Large (multi-week / multi-month) results arrive gzip-compressed from the page; plain JSON still works.
    const raw = Buffer.from(await req.arrayBuffer());
    let payload: OneReconResult;
    try { payload = JSON.parse((req.headers.get('x-body-encoding') === 'gzip' ? gunzipSync(raw) : raw).toString('utf8')) as OneReconResult; }
    catch { return NextResponse.json({ error: 'The export data could not be read. Please run the reconciliation again and retry the export.' }, { status: 400 }); }
    if (!payload?.rows || !Array.isArray(payload.rows)) return NextResponse.json({ error: 'Invalid reconciliation payload.' }, { status: 400 });
    const buf = await buildOneReconWorkbook(payload);
    return new NextResponse(new Uint8Array(buf), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="SVMA_One_Reconciliation.xlsx"' } });
  } catch (error) {
    logServerError('reconcile/one/export', error);
    return NextResponse.json({ error: errorMessage(error, 'Unable to export.') }, { status: 500 });
  }
}
