import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendPushToUser } from '@/lib/push';

export type NewException = {
  exceptionType: string;
  severity: 'info' | 'warning' | 'critical';
  reportDate: string;
  productId?: string | null;
  module: string;
  referenceIds?: Record<string, unknown>;
  expectedValue?: number | null;
  actualValue?: number | null;
  variance?: number | null;
  variancePct?: number | null;
  toleranceUsed?: number | null;
  description: string;
};

// Confirmed with the user: both 'critical' and 'warning' severity exceptions
// auto-create a ticket (not critical-only) — 'info' never does.
const AUTO_TICKET_SEVERITIES = new Set(['critical', 'warning']);

const exceptionKey = (e: { exceptionType: string; reportDate: string; productId?: string | null; referenceIds?: Record<string, unknown> }) =>
  `${e.exceptionType}|${e.reportDate}|${e.productId || JSON.stringify(e.referenceIds || {})}`;

/** Writes deterministic ERP exceptions, auto-creates a linked ticket on
 * deviation_tickets for critical/warning severities (never invents the
 * expected/actual/variance values that got it here — those are always
 * passed in already computed by lib/ops/reconciliation.ts), and notifies
 * management + ops_operator users. Mirrors the recipient-resolution pattern
 * in app/api/admin/users/route.ts's access-request notification block.
 *
 * Idempotent against re-running reconciliation for the same date (e.g. a
 * later same-day upload for an append-only report type): a candidate whose
 * (exception_type, report_date, product/reference key) already has an OPEN
 * exception is skipped rather than logged again — confirmed live-testing
 * would otherwise double a still-unresolved variance into a second
 * exception + ticket every time reconciliation re-ran for that date. */
export async function writeExceptions(exceptions: NewException[]): Promise<{ created: number; ticketsCreated: number }> {
  if (!exceptions.length) return { created: 0, ticketsCreated: 0 };
  const db = supabaseAdmin();
  const types = [...new Set(exceptions.map(e => e.exceptionType))];
  const dates = [...new Set(exceptions.map(e => e.reportDate))];
  const { data: existingOpen } = await db.from('ops_exceptions').select('exception_type,report_date,product_id,reference_ids').eq('status', 'open').in('exception_type', types).in('report_date', dates);
  const openKeys = new Set((existingOpen || []).map((r: any) => exceptionKey({ exceptionType: r.exception_type, reportDate: r.report_date, productId: r.product_id, referenceIds: r.reference_ids })));
  const fresh = exceptions.filter(e => !openKeys.has(exceptionKey(e)));
  if (!fresh.length) return { created: 0, ticketsCreated: 0 };
  const { data: inserted, error } = await db.from('ops_exceptions').insert(fresh.map(e => ({
    exception_type: e.exceptionType, severity: e.severity, report_date: e.reportDate, product_id: e.productId || null,
    module: e.module, reference_ids: e.referenceIds || {}, expected_value: e.expectedValue ?? null, actual_value: e.actualValue ?? null,
    variance: e.variance ?? null, variance_pct: e.variancePct ?? null, tolerance_used: e.toleranceUsed ?? null, description: e.description,
  }))).select('id,severity,exception_type,report_date,description');
  if (error || !inserted) throw new Error('Could not save ERP exceptions.');

  const toTicket = inserted.filter((r: any) => AUTO_TICKET_SEVERITIES.has(r.severity));
  let ticketsCreated = 0;
  if (toTicket.length) {
    const nowStamp = Date.now();
    const rows = toTicket.map((r: any, i: number) => ({
      ticket_no: `SVMA-ERP-${r.report_date.replace(/-/g, '')}-${nowStamp}-${i}`,
      ops_exception_id: r.id, module: 'operations_intelligence', status: 'open',
      due_at: new Date(Date.now() + (r.severity === 'critical' ? 4 : 24) * 3600000).toISOString(),
    }));
    const { data: tickets } = await db.from('deviation_tickets').insert(rows).select('id');
    ticketsCreated = tickets?.length || 0;

    try {
      const { data: recipients } = await db.from('user_roles').select('user_id').in('role', ['super_admin', 'admin', 'ceo', 'management', 'ops_operator']);
      const recipientIds = Array.from(new Set((recipients || []).map((r: any) => r.user_id).filter(Boolean)));
      if (recipientIds.length) {
        const title = `${toTicket.length} new ERP exception${toTicket.length === 1 ? '' : 's'}`;
        const body = toTicket.slice(0, 3).map((r: any) => r.description).join(' · ');
        await db.from('notifications').insert(recipientIds.map(uid => ({ user_id: uid, event_type: 'ops_exception', title, body, severity: 'warning', entity_type: 'ops_exception', entity_id: toTicket[0].id, push_sent_at: new Date().toISOString() })));
        await Promise.all(recipientIds.map(uid => sendPushToUser(db, uid, { title, body, severity: 'warning', tag: 'ops_exception', url: '/operations/exceptions' }).catch(() => {})));
      }
    } catch { /* notification failure never blocks exception/ticket creation */ }
  }
  return { created: inserted.length, ticketsCreated };
}
