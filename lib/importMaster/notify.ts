import type { supabaseAdmin } from '@/lib/supabase/admin';
import { sendPushToUser } from '@/lib/push';
import { contractAlerts } from '@/lib/importSettlement/alerts';
import { buildImportStatus, loadAlertFacts, istToday, istHour, type ImportStatus } from './status';

type Db = ReturnType<typeof supabaseAdmin>;
/** The person who keeps the import records and receives every "input needed" request and the daily status. */
export const IMPORT_DATA_OWNER_EMAILS = ['muthumari@svma.app'];
/** Management who get the daily status alongside her. */
const MANAGEMENT_ROLES = ['management', 'ceo'];
/** Everyone who works the Import module or oversees it — date-driven alerts go to all of them. */
const ALERT_ROLES = ['import_operator', 'import_manager', 'ceo', 'management', 'super_admin'];

async function ownerIds(db: Db) {
  const { data } = await db.from('profiles').select('id,email').in('email', IMPORT_DATA_OWNER_EMAILS);
  return (data || []).map(p => p.id as string);
}
/** Role-based recipients plus anyone given Import edit access in User Management (the module-access route, e.g. a finance manager) plus the owner. */
export async function alertRecipients(db: Db): Promise<string[]> {
  const [roles, access, owners] = await Promise.all([
    db.from('user_roles').select('user_id').in('role', ALERT_ROLES),
    db.from('user_module_access').select('user_id').eq('module', 'import').eq('can_edit', true),
    ownerIds(db),
  ]);
  return Array.from(new Set([...(roles.data || []).map(r => r.user_id), ...(access.data || []).map(r => r.user_id), ...owners].filter(Boolean)));
}
async function dailyRecipients(db: Db): Promise<string[]> {
  const [roles, owners] = await Promise.all([db.from('user_roles').select('user_id').in('role', MANAGEMENT_ROLES), ownerIds(db)]);
  return Array.from(new Set([...(roles.data || []).map(r => r.user_id), ...owners].filter(Boolean)));
}

type Row = { user_id: string; event_type: string; title: string; body: string; severity: string; entity_type: string; entity_id: string; dedupe_key: string };
/** Inserts once per dedupe_key and pushes only what was newly inserted. */
async function send(db: Db, rows: Row[], url: string, tag: string): Promise<number> {
  if (!rows.length) return 0;
  const { data: fresh } = await db.from('notifications').upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true }).select('id,user_id,title,body,severity');
  if (!fresh?.length) return 0;
  await Promise.all(fresh.map((n: any) => sendPushToUser(db, n.user_id, { title: n.title, body: n.body || '', severity: n.severity, tag, url }).catch(() => {})));
  await db.from('notifications').update({ push_sent_at: new Date().toISOString() }).in('id', fresh.map((n: any) => n.id));
  return fresh.length;
}

/** Date-driven contract alerts (shipment window, ETA, BOE, delivery, settlement) — once per contract step and person. */
export async function runContractAlerts(db: Db, today = istToday()): Promise<number> {
  const [facts, recipients] = await Promise.all([loadAlertFacts(db), alertRecipients(db)]);
  let sent = 0;
  for (const f of facts) for (const a of contractAlerts(f, today))
    sent += await send(db, recipients.map(uid => ({ user_id: uid, event_type: 'import_contract_alert', title: a.title, body: a.body, severity: a.severity, entity_type: 'import_contract', entity_id: f.id, dedupe_key: `import_contract:${f.id}:${a.key}:${uid}` })), `/import/contracts/${f.id}`, 'import_contract');
  return sent;
}

export function digestText(st: ImportStatus, dateLabel: string) {
  const lines: string[] = [];
  lines.push(`${st.openRecords} open record${st.openRecords === 1 ? '' : 's'} • ${st.pendingContracts.length} contract${st.pendingContracts.length === 1 ? '' : 's'} awaiting review`);
  lines.push(st.recordsNeedingInput ? `${st.recordsNeedingInput} record${st.recordsNeedingInput === 1 ? '' : 's'} need input (${st.fieldsNeeded} field${st.fieldsNeeded === 1 ? '' : 's'} empty)` : 'No input needed on open records');
  if (st.contractsWithoutRecord.length) lines.push(`${st.contractsWithoutRecord.length} confirmed contract${st.contractsWithoutRecord.length === 1 ? '' : 's'} without an import record`);
  if (st.alerts.length) lines.push(`${st.alerts.length} date alert${st.alerts.length === 1 ? '' : 's'}: ${st.alerts.slice(0, 2).map(a => a.title.split(' • ')[0].toLowerCase()).join(', ')}${st.alerts.length > 2 ? '…' : ''}`);
  const worst = st.records.filter(r => r.due.length).sort((a, b) => b.due.length - a.due.length).slice(0, 3).map(r => `${r.refCode} (${r.due.length})`);
  if (worst.length) lines.push(`Most to fill: ${worst.join(', ')}`);
  const attention = st.recordsNeedingInput || st.pendingContracts.length || st.alerts.length || st.contractsWithoutRecord.length;
  return { title: `Import status • ${dateLabel}`, body: lines.join(' — '), severity: attention ? 'warning' : 'info' };
}

/** The morning status: one notification per person per day, sent as soon as the server is awake after 08:00 IST. */
export async function maybeRunImportDaily(db: Db, now = Date.now(), force = false): Promise<{ sent: number; skipped?: string }> {
  const today = istToday(now);
  if (!force && istHour(now) < 8) return { sent: 0, skipped: 'before 08:00 IST' };
  const done = await db.from('notifications').select('id', { head: true, count: 'exact' }).like('dedupe_key', `import_daily:${today}:%`);
  if (!force && (done.count || 0) > 0) return { sent: 0, skipped: 'already sent today' };
  const [st, recipients] = await Promise.all([buildImportStatus(db, today), dailyRecipients(db)]);
  const label = new Date(`${today}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
  const t = digestText(st, label);
  const sent = await send(db, recipients.map(uid => ({ user_id: uid, event_type: 'import_daily_status', title: t.title, body: t.body, severity: t.severity, entity_type: 'import_status', entity_id: today, dedupe_key: `import_daily:${today}:${uid}` })), '/import/status', 'import_daily');
  await runContractAlerts(db, today).catch(() => 0);
  return { sent };
}

/** Sent to the data owner when a contract becomes an import record: what she needs to fill in. */
export async function notifyRecordCreated(db: Db, entry: { id: string; ref: string; contractNo: string; supplier: string }, missing: number) {
  const owners = await ownerIds(db);
  return send(db, owners.map(uid => ({ user_id: uid, event_type: 'import_input_needed', title: `New import record ${entry.ref} • ${entry.supplier}`, body: `Created from contract ${entry.contractNo}. ${missing} field${missing === 1 ? '' : 's'} still need your input — open it from Import status.`, severity: 'warning', entity_type: 'import_entry', entity_id: entry.id, dedupe_key: `import_input:${entry.id}:${uid}` })), '/import/status', 'import_input');
}
