// MenThee ERP "MTReport" Report API v2 — read-only JSON access to the company's ERP reports (see MentheeERP_API_Client_Guide).
// Flow: authorize (Client ID + company + location -> one-time code) -> token (code -> 60 min access token + 30 day refresh token)
// -> report calls with the Bearer token. One token is requested and reused (the API allows 20 token calls and 60 report calls a
// minute), renewed with the refresh token, and only when that fails is a fresh code requested. Tokens live in memory only and are
// never logged or placed in an error message.

export type MtReportConfig = { baseUrl: string; clientId: string; companyId: string; locationId: string; scope: string };

export class MtReportError extends Error {
  constructor(message: string, readonly status: number, readonly code: string, readonly fieldErrors?: Record<string, string[]>) { super(message); this.name = 'MtReportError'; }
}

export function mtReportConfig(env: Record<string, string | undefined> = process.env): MtReportConfig {
  const baseUrl = (env.MTREPORT_BASE_URL || '').replace(/\/+$/, ''), clientId = env.MTREPORT_CLIENT_ID || '', companyId = env.MTREPORT_COMPANY_ID || '', locationId = env.MTREPORT_LOCATION_ID || '';
  const missing = [['MTREPORT_BASE_URL', baseUrl], ['MTREPORT_CLIENT_ID', clientId], ['MTREPORT_COMPANY_ID', companyId], ['MTREPORT_LOCATION_ID', locationId]].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new MtReportError(`ERP report API is not configured (${missing.join(', ')}).`, 500, 'not_configured');
  // The scope is sent exactly as registered for the client; reports.all covers every report including later ones.
  return { baseUrl, clientId, companyId, locationId, scope: env.MTREPORT_SCOPE || 'reports.purchase-order' };
}

type Tokens = { access: string; accessExpiresAt: number; refresh: string; refreshExpiresAt: number };
const cache = new Map<string, Tokens>();
const keyOf = (c: MtReportConfig) => `${c.baseUrl}|${c.clientId}|${c.companyId}|${c.locationId}|${c.scope}`;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function post(c: MtReportConfig, path: string, body: string, contentType: string, headers: Record<string, string> = {}) {
  let res: Response;
  try { res = await fetch(`${c.baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': contentType, Accept: 'application/json', ...headers }, body, cache: 'no-store', signal: AbortSignal.timeout(60000) }); }
  catch (e) { throw new MtReportError(`Could not reach the ERP report API (${e instanceof Error ? e.message : 'network error'}).`, 503, 'unreachable'); }
  const raw = await res.text();
  let json: any = null; try { json = raw ? JSON.parse(raw) : null; } catch { json = null; }
  return { res, json, raw };
}

function tokenError(status: number, json: any): MtReportError {
  const code = String(json?.error || (json?.errors ? 'validation_error' : 'token_error'));
  const detail = json?.error_description || (json?.errors ? Object.entries(json.errors).map(([k, v]) => `${k || 'request'}: ${[].concat(v as any).join(' ')}`).join('; ').slice(0, 300) : '');
  return new MtReportError(`ERP token request failed (HTTP ${status}, ${code}${detail ? `: ${detail}` : ''}).`, status, code);
}

async function authorizeAndExchange(c: MtReportConfig): Promise<Tokens> {
  // The guide shows scopes as a list, but the live server rejects a list ("Unexpected character ... value: [") and accepts the scope
  // as plain text — so text is sent first, and the documented list shape is the fallback should the server ever follow the guide.
  const authorize = (scopes: string | string[]) => post(c, '/api/v2/reports/oauth/authorize', JSON.stringify({ clientId: c.clientId, scopes, companyId: c.companyId, locationId: c.locationId }), 'application/json');
  let a = await authorize(c.scope);
  if (a.res.status === 400 && !a.json?.code && (a.json?.errors?.scopes || a.json?.error === 'invalid_request')) { const b = await authorize([c.scope]); if (b.res.ok && b.json?.code) a = b; }
  if (!a.res.ok || !a.json?.code) throw tokenError(a.res.status, a.json);
  // The token call is a form, not JSON, and carries only these two fields.
  const t = await post(c, '/api/v2/reports/oauth/token', new URLSearchParams({ grant_type: 'authorization_code', code: String(a.json.code) }).toString(), 'application/x-www-form-urlencoded');
  if (!t.res.ok || !t.json?.access_token) throw tokenError(t.res.status, t.json);
  return toTokens(t.json);
}

function toTokens(j: any, keepRefresh?: string): Tokens {
  const now = Date.now();
  return { access: String(j.access_token), accessExpiresAt: now + Number(j.expires_in || 3600) * 1000, refresh: String(j.refresh_token || keepRefresh || ''), refreshExpiresAt: now + Number(j.refresh_expires_in || 2592000) * 1000 };
}

async function accessToken(c: MtReportConfig): Promise<string> {
  const k = keyOf(c); let t = cache.get(k);
  if (t && t.accessExpiresAt - Date.now() > 60000) return t.access;
  if (t?.refresh && t.refreshExpiresAt > Date.now()) {
    const r = await post(c, '/api/v2/reports/oauth/token', new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh }).toString(), 'application/x-www-form-urlencoded');
    if (r.res.ok && r.json?.access_token) { t = toTokens(r.json, t.refresh); cache.set(k, t); return t.access; }
    if (r.json?.error && r.json.error !== 'invalid_grant') throw tokenError(r.res.status, r.json);
  }
  t = await authorizeAndExchange(c); cache.set(k, t); return t.access;
}

/** Calls one report endpoint and returns its rows. Retries once after a 401 (expired token) and once after a 429 (waits Retry-After). */
export async function callReport<T = Record<string, unknown>>(endpoint: string, filter: Record<string, unknown>, config: MtReportConfig = mtReportConfig()): Promise<T[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const token = await accessToken(config);
    const r = await post(config, `/api/v2/reports/${endpoint}`, JSON.stringify(filter), 'application/json', { Authorization: `Bearer ${token}` });
    if (r.res.ok) return Array.isArray(r.json) ? r.json : (r.json?.data && Array.isArray(r.json.data) ? r.json.data : []);
    if (r.res.status === 401 && attempt < 2) { cache.delete(keyOf(config)); continue; }
    if (r.res.status === 429 && attempt < 2) { await sleep(Math.min(30, Number(r.res.headers.get('Retry-After')) || 5) * 1000); continue; }
    const fe = r.json?.errors && typeof r.json.errors === 'object' ? (r.json.errors as Record<string, string[]>) : undefined;
    const why = fe ? Object.entries(fe).map(([k, v]) => `${k}: ${[].concat(v as any).join(' ')}`).join('; ') : r.json?.error_description || r.json?.error || r.json?.message || '';
    throw new MtReportError(`ERP report "${endpoint}" failed (HTTP ${r.res.status}${why ? ` — ${why}` : ''}).`, r.res.status, String(r.json?.error || `http_${r.res.status}`), fe);
  }
  throw new MtReportError(`ERP report "${endpoint}" could not be read.`, 500, 'failed');
}

// ---- the three reports --------------------------------------------------------------------------------------------------------
export type InwardPaymentRow = {
  paymentReferenceNo: string; paymentDate: string; bankName: string; supplierName: string; supplierLocationName: string;
  lotNumber: string; amount: number; totalAmount: number; supplierId: number; companyId: string;
};
const day = (d: string) => Date.parse(`${d}T00:00:00Z`);
const addDays = (d: string, n: number) => new Date(day(d) + n * 86400000).toISOString().slice(0, 10);

/** A report call may cover at most 366 days: longer ranges are split and the rows joined. */
export function splitRange(from: string, to: string, maxDays = 366): { from: string; to: string }[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) throw new MtReportError('Choose a valid date range (yyyy-MM-dd, From not after To).', 400, 'invalid_range');
  const out: { from: string; to: string }[] = [];
  for (let s = from; s <= to; s = addDays(s, maxDays)) out.push({ from: s, to: addDays(s, maxDays - 1) < to ? addDays(s, maxDays - 1) : to });
  return out;
}

/** Payments made to suppliers in a date range, one line per bill (lot) paid. */
export async function inwardPayments(range: { from: string; to: string; supplierIds?: number[] }, config?: MtReportConfig): Promise<InwardPaymentRow[]> {
  const rows: InwardPaymentRow[] = [];
  for (const r of splitRange(range.from, range.to)) rows.push(...await callReport<InwardPaymentRow>('inward-payment', { ...r, ...(range.supplierIds?.length ? { supplierIds: range.supplierIds } : {}) }, config));
  return rows;
}
/** Purchase documents in a date range. The filter fields beyond from / to are those sent with the access details. */
export const purchaseDetails = (filter: Record<string, unknown>, config?: MtReportConfig) => callReport('purchase-order', filter, config);
/** Purchase contracts not yet fully received, as of a date. */
export const purchaseOrderPending = (filter: Record<string, unknown>, config?: MtReportConfig) => callReport('purchase-order-pending', filter, config);
