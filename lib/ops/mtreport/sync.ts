import { supabaseAdmin } from '@/lib/supabase/admin';
import { fetchAllRows } from '@/lib/supabase/fetchAll';
import { callReport, inwardPayments, mtReportConfig, MtReportError, splitRange, type InwardPaymentRow } from './client';

// Daily consolidation of the ERP Report API into erp_api_* tables (sql/073). Payments and purchase documents accumulate by row
// identity — unchanged rows are left alone, edited ones updated, new ones added — and the pending purchase contracts are kept as one
// snapshot per day. Each run re-reads a trailing window so late entries and edits in the ERP are picked up.

export type SyncDetail = { rows: number; added: number; changed: number; unchanged: number; from?: string; to?: string; error?: string };
export type SyncResult = { runId: string; status: 'completed' | 'partial' | 'failed'; details: Record<string, SyncDetail> };

const BACKFILL_FROM = '2025-04-01';   // the API has the whole of FY 2025-26 onwards
const TRAILING_DAYS = 60;             // each daily run re-reads this far back
const istToday = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const day = (v: unknown) => String(v ?? '').slice(0, 10);
// Change detection only (not security): two 53-bit cyrb53 passes over the row's JSON give a 106-bit fingerprint without Node's crypto,
// which keeps this module loadable from instrumentation.ts in every runtime.
function cyrb53(str: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
const hash = (v: unknown) => { const j = JSON.stringify(v); return `${cyrb53(j, 0).toString(36)}${cyrb53(j, 7).toString(36)}`; };
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));

let running = false;

/** Adds a #n suffix to repeated keys inside one pull, so two genuinely identical lines both survive. */
function keyed<T>(rows: T[], base: (r: T) => string): { key: string; row: T }[] {
  const seen = new Map<string, number>();
  return rows.map(row => { const b = base(row), c = (seen.get(b) || 0) + 1; seen.set(b, c); return { key: c === 1 ? b : `${b}#${c}`, row }; });
}

async function upsertChanged(table: string, dateCol: string, from: string, to: string, items: { key: string; hash: string; record: Record<string, unknown> }[]): Promise<{ added: number; changed: number; unchanged: number }> {
  const db = supabaseAdmin();
  const { data: existing, error } = await fetchAllRows<{ row_key: string; row_hash: string }>((a, b) => db.from(table).select('row_key,row_hash').gte(dateCol, from).lte(dateCol, to).order('row_key').range(a, b));
  if (error) throw error;
  const have = new Map(existing.map(r => [r.row_key, r.row_hash]));
  const write: Record<string, unknown>[] = [];
  let added = 0, changed = 0, unchanged = 0;
  for (const it of items) {
    const old = have.get(it.key);
    if (old === undefined) added++; else if (old !== it.hash) changed++; else { unchanged++; continue; }
    write.push({ ...it.record, row_key: it.key, row_hash: it.hash, updated_at: new Date().toISOString() });
  }
  for (let i = 0; i < write.length; i += 500) {
    const { error: e } = await db.from(table).upsert(write.slice(i, i + 500), { onConflict: 'row_key' });
    if (e) throw e;
  }
  return { added, changed, unchanged };
}

async function windowFrom(table: string, col: string, today: string): Promise<string> {
  const { data } = await supabaseAdmin().from(table).select(col).order(col, { ascending: false }).limit(1).maybeSingle();
  const last = (data as any)?.[col] as string | undefined;
  return last ? addDays(last, -TRAILING_DAYS) : BACKFILL_FROM;
}

async function syncPayments(today: string): Promise<SyncDetail> {
  const from = await windowFrom('erp_api_payments', 'payment_date', today);
  const rows = await inwardPayments({ from, to: today });
  const items = keyed<InwardPaymentRow>(rows, r => `${r.paymentReferenceNo}|${r.supplierId}|${r.lotNumber || ''}|${day(r.paymentDate)}`).map(({ key, row: r }) => ({
    key, hash: hash(r),
    record: { payment_ref: String(r.paymentReferenceNo), payment_date: day(r.paymentDate), bank_name: s(r.bankName), supplier_id: n(r.supplierId), supplier_name: s(r.supplierName), supplier_location: s(r.supplierLocationName), lot_number: s(r.lotNumber), amount: n(r.amount), total_amount: n(r.totalAmount), company_id: s(r.companyId) },
  }));
  return { rows: rows.length, from, to: today, ...await upsertChanged('erp_api_payments', 'payment_date', from, today, items) };
}

async function syncPurchases(today: string): Promise<SyncDetail> {
  const from = await windowFrom('erp_api_purchase_docs', 'po_date', today);
  const rows: Record<string, any>[] = [];
  for (const r of splitRange(from, today)) rows.push(...await callReport<Record<string, any>>('purchase-order', r));
  const items = keyed(rows, r => `${r.poNumber}|${r.materialName || ''}|${r.supplierName || ''}`).map(({ key, row: r }) => ({
    key, hash: hash(r),
    record: { title: s(r.title), po_number: String(r.poNumber), po_date: day(r.poDate) || null, supplier_name: s(r.supplierName), material_name: s(r.materialName), ordered_qty: n(r.orderedQty), quantity_kg: n(r.quantityKG), rate: n(r.rate), taxable_amt: n(r.taxableAmt), tax_amount: n(r.taxAmount), total_amount: n(r.totalAmount), location_name: s(r.locationName), status: s(r.status), raw: r },
  }));
  return { rows: rows.length, from, to: today, ...await upsertChanged('erp_api_purchase_docs', 'po_date', from, today, items) };
}

async function syncPending(today: string): Promise<SyncDetail> {
  const db = supabaseAdmin();
  const rows = await callReport<Record<string, any>>('purchase-order-pending', { asOnDate: today });
  const seen = new Set<string>();
  const records = rows.map(r => ({ snapshot_date: today, contract_no: String(r.contractNo), product_name: String(r.productName ?? ''), contract_date: day(r.contractDate) || null, party_name: s(r.partyName), broker_name: s(r.brokerName), contract_qty: n(r.contractQty), received_qty: n(r.receivedQty), balance_qty: n(r.balanceQty), rate: n(r.rate) }))
    .filter(r => { const k = `${r.contract_no}|${r.product_name}`; if (seen.has(k)) return false; seen.add(k); return true; });
  // Re-running the same day replaces that day's snapshot instead of adding to it.
  const { error: de } = await db.from('erp_api_pending_contracts').delete().eq('snapshot_date', today);
  if (de) throw de;
  for (let i = 0; i < records.length; i += 500) { const { error } = await db.from('erp_api_pending_contracts').insert(records.slice(i, i + 500)); if (error) throw error; }
  return { rows: rows.length, added: records.length, changed: 0, unchanged: 0, from: today, to: today };
}

const errText = (e: unknown) => (e instanceof MtReportError ? e.message : e instanceof Error ? e.message : String(e)).slice(0, 400);

/** Pulls all three reports, consolidates them, and records the run. */
export async function runErpApiSync(trigger: 'schedule' | 'manual'): Promise<SyncResult> {
  if (running) throw new MtReportError('A sync is already running.', 409, 'busy');
  mtReportConfig(); // fails clearly when the four MTREPORT_* values are missing
  running = true;
  const db = supabaseAdmin();
  const today = istToday();
  const { data: run, error: re } = await db.from('erp_api_sync_runs').insert({ trigger, status: 'running' }).select('id').single();
  if (re) { running = false; throw new MtReportError(`The ERP sync tables are not set up (${re.message}). Run sql/073_erp_api_sync.sql in Supabase.`, 500, 'not_set_up'); }
  const details: Record<string, SyncDetail> = {};
  try {
    for (const [name, fn] of [['payments', syncPayments], ['purchases', syncPurchases], ['pending', syncPending]] as const) {
      try { details[name] = await fn(today); } catch (e) { details[name] = { rows: 0, added: 0, changed: 0, unchanged: 0, error: errText(e) }; }
    }
    const failed = Object.values(details).filter(d => d.error).length;
    const status: SyncResult['status'] = failed === 0 ? 'completed' : failed === 3 ? 'failed' : 'partial';
    await db.from('erp_api_sync_runs').update({ status, finished_at: new Date().toISOString(), details, error: failed ? Object.entries(details).filter(([, d]) => d.error).map(([k, d]) => `${k}: ${d.error}`).join(' | ').slice(0, 800) : null }).eq('id', run.id);
    return { runId: run.id, status, details };
  } finally { running = false; }
}

/** Called by the background loop every few minutes: runs the daily pull once per day (after 06:00 IST), and not more often than hourly after a failure. */
export async function maybeRunScheduledSync(): Promise<void> {
  if (running) return;
  try { mtReportConfig(); } catch { return; } // not configured: nothing to do
  const ist = new Date(Date.now() + 5.5 * 3600000);
  if (ist.getUTCHours() < 6) return;
  const db = supabaseAdmin();
  const { data: last, error } = await db.from('erp_api_sync_runs').select('started_at,status').order('started_at', { ascending: false }).limit(1).maybeSingle();
  if (error) return; // tables not created yet
  if (last) {
    const age = Date.now() - new Date(last.started_at).getTime();
    const startedIst = new Date(new Date(last.started_at).getTime() + 5.5 * 3600000).toISOString().slice(0, 10);
    if (last.status === 'running') { if (age < 30 * 60000) return; }                         // still going (an older "running" row is a stale leftover)
    else if (last.status === 'failed') { if (age < 3600000) return; }                         // after a failure wait an hour before trying again
    else if (startedIst === istToday()) return;                                               // already done today
  }
  await runErpApiSync('schedule');
}
