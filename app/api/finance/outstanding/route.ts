import { moduleAuthorization, FINANCE_ROLES } from '@/lib/authorize';
import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { gunzipSync } from 'zlib';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { fetchAllRows } from '@/lib/supabase/fetchAll';
import { errorMessage, logServerError } from '@/lib/errors';
import { buildView } from '@/lib/outstanding/view';
import { planRemovals } from '@/lib/outstanding/merge';
import { computeOutstanding, voucherKey, VOUCHER_VERSION, type CompactVoucher } from '@/lib/outstanding/engine';

export const runtime = 'nodejs';
export const maxDuration = 120;

type Range = { from: string; to: string };
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const addDay = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Merges overlapping or back-to-back date ranges, so the list shows which dates the uploaded Day Books actually cover. */
function mergeRanges(ranges: Range[]): Range[] {
  const sorted = ranges.filter(r => isDate(r.from) && isDate(r.to)).sort((a, b) => a.from.localeCompare(b.from));
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.from <= addDay(last.to, 1)) { if (r.to > last.to) last.to = r.to; } else out.push({ ...r });
  }
  return out;
}

const str = (v: unknown, n = 200) => String(v ?? '').slice(0, n);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const sanitize = (v: any): CompactVoucher | null => {
  if (!v || !isDate(v.date) || !Array.isArray(v.lines)) return null;
  const lines = v.lines.map((l: any) => ({
    name: str(l?.name), dr: typeof l?.dr === 'number' ? l.dr : null, cr: typeof l?.cr === 'number' ? l.cr : null,
    refs: (Array.isArray(l?.refs) ? l.refs : []).map((r: any) => ({ kind: str(r?.kind, 20), ref: str(r?.ref, 120), amount: num(r?.amount), drcr: r?.drcr === 'Cr' ? 'Cr' : 'Dr' })).filter((r: any) => r.ref),
  })).filter((l: any) => l.name && l.refs.length);
  if (!lines.length) return null;
  return { ver: VOUCHER_VERSION, date: v.date, vchType: str(v.vchType, 80), vchNo: str(v.vchNo, 60), head: str(v.head), lines, imp: !!v.imp, exp: !!v.exp, usd: !!v.usd, note: str(v.note) };
};
const hashOf = (v: CompactVoucher) => createHash('sha1').update(JSON.stringify([v.lines, v.imp, v.exp, v.usd])).digest('hex');

/** The newest consolidated result — everything the Creditors / Debtors screen needs. */
export async function GET() {
  try {
    const az = await moduleAuthorization('finance_transaction', FINANCE_ROLES);
    if (!az.ok) return NextResponse.json({ error: az.status === 401 ? 'Not authenticated' : 'Finance access not assigned' }, { status: az.status });
    const view = await buildView();
    return NextResponse.json(view || { empty: true });
  } catch (error) {
    logServerError('finance/outstanding:get', error);
    return NextResponse.json({ error: errorMessage(error, 'Unable to load Creditors / Debtors.') }, { status: 500 });
  }
}

/** Merges an uploaded Day Book into the stored vouchers and recomputes the outstanding from the whole set. The Day Book is read
 * in the browser (a whole year is more than the server's memory allows); only its bill-bearing vouchers arrive here, gzipped. */
export async function POST(req: NextRequest) {
  try {
    const az = await moduleAuthorization('finance_transaction', FINANCE_ROLES);
    if (!az.ok) return NextResponse.json({ error: az.status === 401 ? 'Not authenticated' : 'Finance access not assigned' }, { status: az.status });
    const raw = Buffer.from(await req.arrayBuffer());
    let body: any;
    try { body = JSON.parse((req.headers.get('x-body-encoding') === 'gzip' ? gunzipSync(raw) : raw).toString('utf8')); }
    catch { return NextResponse.json({ error: 'The Day Book data could not be read. Please upload the file again.' }, { status: 400 }); }
    if (!body || !Array.isArray(body.vouchers) || !isDate(body.periodFrom) || !isDate(body.periodTo)) return NextResponse.json({ error: 'The Day Book data is incomplete. Please upload the file again.' }, { status: 400 });
    if (body.vouchers.length > 300000) return NextResponse.json({ error: 'The Day Book is too large to merge in one go. Upload it in shorter periods.' }, { status: 413 });
    const db = supabaseAdmin();

    // Identity + content fingerprint for every voucher in the file.
    const fileRows = new Map<string, { v: CompactVoucher; hash: string }>();
    for (const x of body.vouchers) {
      const v = sanitize(x); if (!v) continue;
      const hash = hashOf(v); let key = voucherKey(v);
      const seen = fileRows.get(key);
      if (seen) { if (seen.hash === hash) continue; key = `${key}#${hash.slice(0, 8)}`; }
      fileRows.set(key, { v, hash });
    }
    let from = body.periodFrom as string, to = body.periodTo as string;
    for (const { v } of fileRows.values()) { if (v.date < from) from = v.date; if (v.date > to) to = v.date; }

    if (!fileRows.size) return NextResponse.json({ error: 'No bill-reference vouchers were found in the uploaded period. Existing Day Book data was not changed.' }, { status: 400 });

    // Vouchers saved by an older reading of the Day Book (which could be a day out) are replaced by this upload, not kept beside it.
    const { error: purgeErr } = await db.from('outstanding_vouchers').delete().or(`payload->>ver.is.null,payload->>ver.neq.${VOUCHER_VERSION}`);
    if (purgeErr) throw purgeErr;

    // What is already stored for the dates this file covers.
    const { data: existingRows, error: exErr } = await fetchAllRows<{ vkey: string; content_hash: string; vch_date: string }>((a, b) => db.from('outstanding_vouchers').select('vkey,content_hash,vch_date').gte('vch_date', from).lte('vch_date', to).order('vkey').range(a, b));
    if (exErr) throw exErr;
    const existing = new Map(existingRows.map(r => [r.vkey, r.content_hash]));
    const toWrite: { vkey: string; vch_date: string; vch_type: string; vch_no: string; content_hash: string; payload: CompactVoucher; updated_at: string }[] = [];
    let added = 0, changed = 0, unchanged = 0, removed = 0;
    let keptDates: string[] = [];
    const replaceExisting = body.replaceExisting === true;

    if (replaceExisting) {
      // Explicit replacement: clear every stored bill-wise voucher in the uploaded date range,
      // then write the file's vouchers. The frontend requires an additional confirmation.
      const { error: deleteErr, count } = await db
        .from('outstanding_vouchers')
        .delete({ count: 'exact' })
        .gte('vch_date', from)
        .lte('vch_date', to);
      if (deleteErr) throw deleteErr;
      removed = count ?? existingRows.length;
      added = fileRows.size;
      for (const [key, { v, hash }] of fileRows) {
        toWrite.push({ vkey: key, vch_date: v.date, vch_type: v.vchType, vch_no: v.vchNo, content_hash: hash, payload: v, updated_at: new Date().toISOString() });
      }
    } else {
      // Normal safe merge: add new vouchers, update edited vouchers and leave other saved vouchers alone.
      for (const [key, { v, hash }] of fileRows) {
        const old = existing.get(key);
        if (old === undefined) added++; else if (old !== hash) changed++; else { unchanged++; continue; }
        toWrite.push({ vkey: key, vch_date: v.date, vch_type: v.vchType, vch_no: v.vchNo, content_hash: hash, payload: v, updated_at: new Date().toISOString() });
      }
      // Remove missing vouchers only on dates that have a sufficiently complete file.
      const fileCountByDate = new Map<string, number>();
      for (const { v } of fileRows.values()) fileCountByDate.set(v.date, (fileCountByDate.get(v.date) || 0) + 1);
      const { remove, keptDates: protectedDates } = planRemovals(existingRows.map(r => ({ row_key: r.vkey, vch_date: r.vch_date })), new Set(fileRows.keys()), fileCountByDate);
      keptDates = protectedDates;
      for (let i = 0; i < remove.length; i += 50) {
        const { error } = await db.from('outstanding_vouchers').delete().in('vkey', remove.slice(i, i + 50));
        if (error) throw error;
      }
      removed = remove.length;
    }

    for (let i = 0; i < toWrite.length; i += 500) {
      const { error } = await db.from('outstanding_vouchers').upsert(toWrite.slice(i, i + 500), { onConflict: 'vkey' });
      if (error) throw error;
    }

    // Coverage: which dates the Day Books uploaded so far span.
    const { data: prev } = await db.from('outstanding_snapshots').select('summary').order('created_at', { ascending: false }).limit(1).maybeSingle();
    const ranges = mergeRanges([...((prev?.summary?.ranges as Range[]) || []), { from, to }]);

    // The outstanding is always worked out from everything stored.
    const { data: stored, error: stErr } = await fetchAllRows<{ payload: CompactVoucher }>((a, b) => db.from('outstanding_vouchers').select('payload').order('vkey').range(a, b));
    if (stErr) throw stErr;
    const result = computeOutstanding(stored.map(r => r.payload), { from: ranges[0].from, to: ranges[ranges.length - 1].to, total: stored.length });
    const warnings = [...result.warnings];
    for (let i = 1; i < ranges.length; i++) warnings.push(`No Day Book has been uploaded for ${ranges[i - 1].to} to ${ranges[i].from} (the days in between) — bills and payments on those dates are missing, so the outstanding may be off until they are uploaded.`);
    // An export taken before the latest payments were entered leaves the newest days with no payment vouchers at all, so the oldest
    // bills of every party still look open. Say so when a recent working day has (almost) none while normal days have many.
    const payDays = new Map<string, number>();
    for (const r of stored) if (/^payment/i.test(r.payload.vchType)) payDays.set(r.payload.date, (payDays.get(r.payload.date) || 0) + 1);
    const last = ranges[ranges.length - 1].to;
    const counts = [...payDays.entries()].filter(([d]) => d <= last).sort(([a], [b]) => a.localeCompare(b));
    const typical = counts.filter(([, n]) => n >= 10).slice(-14).map(([, n]) => n).sort((a, b) => a - b);
    const median = typical.length ? typical[Math.floor(typical.length / 2)] : 0;
    // Only the quiet days AFTER the last normal payment day count: a quiet day with busy days after it was a real quiet day.
    const lastBusy = counts.filter(([, n]) => n >= 10).map(([d]) => d).pop() || '';
    const quiet: string[] = [];
    for (let d = lastBusy ? addDay(lastBusy, 1) : last; lastBusy && d <= last; d = addDay(d, 1)) {
      const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
      if (dow >= 1 && dow <= 5 && (payDays.get(d) || 0) <= 2) quiet.push(d);
    }
    if (median >= 10 && quiet.length) warnings.push(`No payment vouchers are saved for ${quiet.reverse().join(', ')}, while about ${median} payments are posted on a normal day. The Day Book may have been exported before those payments were entered in Tally — bills they settle will still show as open. Export the Day Book again and upload it.`);
    if (changed) warnings.push(`${changed} voucher${changed === 1 ? ' was' : 's were'} edited in Tally since an earlier upload and ${changed === 1 ? 'has' : 'have'} been updated.`);
    if (removed) warnings.push(`${removed} voucher${removed === 1 ? '' : 's'} saved earlier ${removed === 1 ? 'is' : 'are'} no longer in Tally for these dates (deleted, cancelled or changed there) and ${removed === 1 ? 'was' : 'were'} removed — for example a debit note replaced when a lot was re-settled.`);
    if (!replaceExisting && keptDates.length) warnings.push(`This file holds far fewer vouchers than were saved for ${keptDates.slice(0, 6).join(', ')}${keptDates.length > 6 ? ` and ${keptDates.length - 6} more date(s)` : ''}, so it looks like a filtered export; vouchers missing from it were kept.`);
    if (replaceExisting) warnings.push(`Replacement mode was used: all previously saved bill-wise vouchers dated ${from} through ${to} were replaced by the uploaded file.`);

    const lastUpload = { fileName: str(body.fileName, 200), at: new Date().toISOString(), from, to, inFile: fileRows.size, added, changed, unchanged, removed, replaceExisting, keptDates: replaceExisting ? 0 : keptDates.length };
    const { data: snap, error } = await db.from('outstanding_snapshots').insert({
      file_name: lastUpload.fileName || null, period_from: ranges[0].from, period_to: ranges[ranges.length - 1].to, voucher_count: stored.length,
      summary: { ranges, lastUpload }, warnings: warnings.slice(0, 30), parties: result.parties, bills: result.bills, created_by: az.user?.id ?? null,
    }).select('id,created_at').single();
    if (error) throw error;
    // Older snapshots only hold a computed result; keep the newest few for audit.
    const { data: old } = await db.from('outstanding_snapshots').select('id').order('created_at', { ascending: false }).range(10, 1000);
    if (old?.length) await db.from('outstanding_snapshots').delete().in('id', old.map(r => r.id));
    return NextResponse.json(await buildView());
  } catch (error) {
    logServerError('finance/outstanding:save', error);
    return NextResponse.json({ error: errorMessage(error, 'Unable to merge the Day Book.') }, { status: 500 });
  }
}
