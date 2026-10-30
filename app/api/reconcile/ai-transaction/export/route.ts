import { moduleAuthorization, FINANCE_ROLES } from '@/lib/authorize';
import { NextRequest, NextResponse } from 'next/server';
import { buildTransactionWorkbook } from '@/lib/reconciliation/export';
import { errorMessage, logServerError } from '@/lib/errors';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const az = await moduleAuthorization('finance_transaction', FINANCE_ROLES);
    if (!az.ok) return NextResponse.json({ error: az.status === 401 ? 'Not authenticated' : 'Finance access not assigned' }, { status: az.status });
    const body = await req.json();
    if (body?.rulesVersion !== 'ai_engine_1') return NextResponse.json({ error: 'This result was produced by a different engine version. Re-run reconciliation and download again.' }, { status: 409 });
    const buf = buildTransactionWorkbook(body);
    const name = `SVMA_AI_Transaction_Reconciliation_${body.reconciliationDate || 'run'}.xlsx`;
    return new NextResponse(new Uint8Array(buf), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${name}"` } });
  } catch (error) {
    logServerError('reconcile/ai-transaction/export', error);
    return NextResponse.json({ error: errorMessage(error, 'Unable to export reconciliation results.') }, { status: 400 });
  }
}
