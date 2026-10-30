import { moduleAuthorization, FINANCE_ROLES } from '@/lib/authorize';
import { NextResponse } from 'next/server';
import { buildView } from '@/lib/outstanding/view';
import { loadResettlements } from '@/lib/outstanding/resettlement';
import { errorMessage, logServerError } from '@/lib/errors';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Re-settled lots (first note → final note) and credit notes (extra payable), from the ERP Credit/Debit Note report, checked against the
 * Tally bills in Creditors / Debtors. */
export async function GET() {
  try {
    const az = await moduleAuthorization('finance_transaction', FINANCE_ROLES);
    if (!az.ok) return NextResponse.json({ error: az.status === 401 ? 'Not authenticated' : 'Finance access not assigned' }, { status: az.status });
    const view = await buildView().catch(() => null);
    return NextResponse.json(await loadResettlements(view?.bills || []));
  } catch (error) {
    logServerError('finance/resettlement', error);
    return NextResponse.json({ error: errorMessage(error, 'Unable to load the resettlement data.') }, { status: 500 });
  }
}
