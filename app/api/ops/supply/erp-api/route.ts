import { moduleAuthorization, OPS_ROLES } from '@/lib/authorize';
import { NextRequest, NextResponse } from 'next/server';
import { callReport, inwardPayments, MtReportError, splitRange } from '@/lib/ops/mtreport/client';
import { errorMessage, logServerError } from '@/lib/errors';

export const runtime = 'nodejs';
export const maxDuration = 120;

const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
// The API allows 60 report calls a minute; the same question asked again within a few minutes is answered from memory.
const cache = new Map<string, { at: number; body: unknown }>();
const TTL = 5 * 60 * 1000;

/** Live read of the ERP Report API for the Supply Intelligence "ERP API" tab. Reads only; nothing is stored. */
export async function GET(req: NextRequest) {
  try {
    const az = await moduleAuthorization('operations_intelligence', OPS_ROLES);
    if (!az.ok) return NextResponse.json({ error: az.status === 401 ? 'Not authenticated' : 'Operations Intelligence access not assigned' }, { status: az.status });
    const q = req.nextUrl.searchParams, report = q.get('report') || '';
    const key = req.nextUrl.search;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL && q.get('fresh') !== '1') return NextResponse.json(hit.body);
    let rows: Record<string, unknown>[] = [];
    if (report === 'pending') {
      const asOn = q.get('asOn');
      if (!isDate(asOn)) return NextResponse.json({ error: 'Choose the as-on date.' }, { status: 400 });
      rows = await callReport('purchase-order-pending', { asOnDate: asOn });
    } else if (report === 'payments' || report === 'purchases') {
      const from = q.get('from'), to = q.get('to');
      if (!isDate(from) || !isDate(to)) return NextResponse.json({ error: 'Choose the From and To dates.' }, { status: 400 });
      if (report === 'payments') rows = await inwardPayments({ from, to }) as unknown as Record<string, unknown>[];
      else for (const r of splitRange(from, to)) rows.push(...await callReport('purchase-order', r));
    } else return NextResponse.json({ error: 'Choose a report: pending, payments or purchases.' }, { status: 400 });
    const body = { report, rows, fetchedAt: new Date().toISOString() };
    cache.set(key, { at: Date.now(), body });
    if (cache.size > 40) cache.delete(cache.keys().next().value as string);
    return NextResponse.json(body);
  } catch (e) {
    if (e instanceof MtReportError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status >= 400 && e.status < 600 ? e.status : 502 });
    logServerError('ops/supply/erp-api', e);
    return NextResponse.json({ error: errorMessage(e, 'Unable to read the ERP report.') }, { status: 500 });
  }
}
