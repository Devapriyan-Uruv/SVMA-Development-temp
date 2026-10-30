import { moduleAuthorization, FINANCE_ROLES } from '@/lib/authorize';
import { NextRequest, NextResponse } from 'next/server';
import { gunzipSync } from 'zlib';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { fetchAllRows } from '@/lib/supabase/fetchAll';
import { errorMessage, logServerError } from '@/lib/errors';
import { buildDaySummary } from '@/lib/daySummary/build';
import { loadErpInputs, loadPaymentHistory, loadErpLoads } from '@/lib/daySummary/load';
import { buildLoads } from '@/lib/daySummary/loads';
import type { DayBookVoucher } from '@/lib/outstanding/engine';

export const runtime = 'nodejs';
export const maxDuration = 120;
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const str = (v: unknown, n = 200) => String(v ?? '').slice(0, n);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

async function authorize() {
  const az = await moduleAuthorization('finance_transaction', FINANCE_ROLES);
  return az.ok ? null : NextResponse.json({ error: az.status === 401 ? 'Not authenticated' : 'Finance access not assigned' }, { status: az.status });
}

/** GET ?dates=1 lists the days saved; GET ?date=yyyy-mm-dd builds that day's summary (checked against the ERP as last uploaded). */
export async function GET(req: NextRequest) {
  try {
    const denied = await authorize(); if (denied) return denied;
    const db = supabaseAdmin(), q = req.nextUrl.searchParams;
    if (q.get('dates')) {
      const { data, error } = await fetchAllRows<{ vch_date: string }>((a, b) => db.from('daybook_day_vouchers').select('vch_date').order('vch_date').range(a, b));
      if (error) return NextResponse.json({ error: 'The Day Summary Ledger is not set up yet — run sql/074_day_summary.sql in Supabase.', code: 'not_set_up' }, { status: 503 });
      const by = new Map<string, number>(); for (const r of data) by.set(r.vch_date, (by.get(r.vch_date) || 0) + 1);
      return NextResponse.json({ dates: [...by.entries()].map(([date, vouchers]) => ({ date, vouchers })).sort((a, b) => b.date.localeCompare(a.date)) });
    }
    const date = q.get('date');
    if (!isDate(date)) return NextResponse.json({ error: 'Choose a date.' }, { status: 400 });
    const load = async (d: string) => (await fetchAllRows<{ payload: DayBookVoucher }>((a, b) => db.from('daybook_day_vouchers').select('payload').eq('vch_date', d).order('vkey').range(a, b))).data.map(r => r.payload);
    const vouchers = await load(date);
    if (!vouchers.length) return NextResponse.json({ error: `No Day Book has been uploaded for ${date}.` }, { status: 404 });
    const [erp, history, erpLoads] = await Promise.all([loadErpInputs(), loadPaymentHistory(date), loadErpLoads(date).catch(() => ({ erpDay: null, pending: null }))]);
    // The previous saved day, for the comparison line.
    const { data: prevRow } = await db.from('daybook_day_vouchers').select('vch_date').lt('vch_date', date).order('vch_date', { ascending: false }).limit(1).maybeSingle();
    let previous = null;
    if (prevRow?.vch_date) { const p = buildDaySummary(prevRow.vch_date, await load(prevRow.vch_date), erp, { paidByLot: new Map() }, null).headline; previous = { sales: p.sales.amount, purchases: p.purchases.amount, received: p.received.amount, sent: p.sent.amount }; }
    return NextResponse.json({ summary: buildDaySummary(date, vouchers, erp, history, previous), loads: buildLoads(date, vouchers, erpLoads.erpDay, erpLoads.pending), previousDate: prevRow?.vch_date || null });
  } catch (e) {
    logServerError('finance/day-summary:get', e);
    return NextResponse.json({ error: errorMessage(e, 'Unable to build the day summary.') }, { status: 500 });
  }
}

/** Saves the vouchers of an uploaded Day Book by date. A date is replaced by the new upload unless the file holds far fewer vouchers
 * for it than are saved (then it looks like a filtered export and the saved day is kept). */
export async function POST(req: NextRequest) {
  try {
    const denied = await authorize(); if (denied) return denied;
    const raw = Buffer.from(await req.arrayBuffer());
    let body: any;
    try { body = JSON.parse((req.headers.get('x-body-encoding') === 'gzip' ? gunzipSync(raw) : raw).toString('utf8')); }
    catch { return NextResponse.json({ error: 'The Day Book data could not be read. Please upload the file again.' }, { status: 400 }); }
    if (!body || !Array.isArray(body.vouchers)) return NextResponse.json({ error: 'The Day Book data is incomplete.' }, { status: 400 });
    const db = supabaseAdmin();
    const byDate = new Map<string, { vkey: string; vch_date: string; vch_type: string; vch_no: string; payload: DayBookVoucher; uploaded_by: string | null }[]>();
    const { data: me } = await moduleAuthorization('finance_transaction', FINANCE_ROLES).then(a => ({ data: a.user?.id as string | undefined }));
    let seq = 0;
    for (const x of body.vouchers) {
      if (!x || !isDate(x.date) || !Array.isArray(x.lines)) continue;
      const lines = x.lines.slice(0, 40).map((l: any) => ({ name: str(l?.name), dr: num(l?.dr), cr: num(l?.cr), refs: (Array.isArray(l?.refs) ? l.refs : []).slice(0, 30).map((r: any) => ({ kind: str(r?.kind, 20), ref: str(r?.ref, 120), amount: num(r?.amount) ?? 0, drcr: r?.drcr === 'Cr' ? 'Cr' : 'Dr' })) })).filter((l: any) => l.name);
      if (!lines.length) continue;
      const v: DayBookVoucher = { date: x.date, vchType: str(x.vchType, 80), vchNo: str(x.vchNo, 60), lines, narration: (Array.isArray(x.narration) ? x.narration : []).slice(0, 4).map((n: any) => str(n, 200)) };
      (byDate.get(v.date) || byDate.set(v.date, []).get(v.date)!).push({ vkey: `${v.date}|${v.vchType.toUpperCase()}|${v.vchNo}|${++seq}`, vch_date: v.date, vch_type: v.vchType, vch_no: v.vchNo, payload: v, uploaded_by: me ?? null });
    }
    const result: { date: string; vouchers: number; replaced: boolean; kept?: string }[] = [];
    for (const [date, rows] of [...byDate.entries()].sort()) {
      const { count, error: ce } = await db.from('daybook_day_vouchers').select('vkey', { count: 'exact', head: true }).eq('vch_date', date);
      if (ce) return NextResponse.json({ error: 'The Day Summary Ledger is not set up yet — run sql/074_day_summary.sql in Supabase.', code: 'not_set_up' }, { status: 503 });
      if ((count || 0) > 0 && rows.length < 0.8 * (count || 0)) { result.push({ date, vouchers: count || 0, replaced: false, kept: `The file has ${rows.length} vouchers for this date but ${count} are saved — it looks like a filtered export, so the saved day was kept.` }); continue; }
      const { error: de } = await db.from('daybook_day_vouchers').delete().eq('vch_date', date); if (de) throw de;
      for (let i = 0; i < rows.length; i += 500) { const { error } = await db.from('daybook_day_vouchers').insert(rows.slice(i, i + 500)); if (error) throw error; }
      result.push({ date, vouchers: rows.length, replaced: (count || 0) > 0 });
    }
    return NextResponse.json({ dates: result });
  } catch (e) {
    logServerError('finance/day-summary:save', e);
    return NextResponse.json({ error: errorMessage(e, 'Unable to save the Day Book.') }, { status: 500 });
  }
}
