import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { errorMessage, logServerError } from '@/lib/errors';
import { maybeRunImportDaily } from '@/lib/importMaster/notify';

export const runtime = 'nodejs';
/** POST — runs the morning Import status on demand (secret-gated, same x-sweep-secret as the other sweeps). `?force=1` re-sends even if today's went out. */
export async function POST(req: NextRequest) {
  try {
    const secret = process.env.PUSH_SWEEP_SECRET;
    if (!secret || req.headers.get('x-sweep-secret') !== secret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json(await maybeRunImportDaily(supabaseAdmin(), Date.now(), req.nextUrl.searchParams.get('force') === '1'));
  } catch (e) {
    logServerError('import/daily', e);
    return NextResponse.json({ error: errorMessage(e, 'Import daily status failed.') }, { status: 500 });
  }
}
