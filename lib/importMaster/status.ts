import type { supabaseAdmin } from '@/lib/supabase/admin';
import { contractAlerts, type AlertFacts, type Alert } from '@/lib/importSettlement/alerts';
import { missingFields, STAGE_LABEL, type Missing } from './master';

type Db = ReturnType<typeof supabaseAdmin>;
export type RecordStatus = { id: string; refCode: string; commodityId: number | null; supplier: string; contractNo: string | null; status: string; due: Missing[]; later: Missing[] };
export type ImportStatus = {
  today: string;
  openRecords: number;
  records: RecordStatus[];
  recordsNeedingInput: number; fieldsNeeded: number;
  pendingContracts: { id: string; ref: string; supplier: string; waitingDays: number }[];
  contractsWithoutRecord: { id: string; ref: string; supplier: string }[];
  alerts: (Alert & { contractId: string })[];
};

export const istToday = (now = Date.now()) => new Date(now + 5.5 * 3600000).toISOString().slice(0, 10);
export const istHour = (now = Date.now()) => new Date(now + 5.5 * 3600000).getUTCHours();

/** The facts the date-driven contract alerts run on (one query set for all unsettled contracts). */
export async function loadAlertFacts(db: Db): Promise<(AlertFacts & { entryId: string | null })[]> {
  const { data: contracts, error } = await db.from('import_contracts').select('id,import_id,contract_number,supplier_name,status,created_at,quantity,shipment_end_date,eta_date,delivery_date,settlement_due_date,settled_at,import_entry_id').is('settled_at', null);
  if (error || !contracts?.length) return [];
  const ids = contracts.map(c => c.id);
  const [inv, links] = await Promise.all([
    db.from('import_contract_invoices').select('contract_id,boe_no,import_entry_id').in('contract_id', ids),
    db.from('import_contract_links').select('contract_id,ref_key').eq('kind', 'erp').eq('status', 'confirmed').in('contract_id', ids),
  ]);
  const entryIds = Array.from(new Set([...contracts.map(c => c.import_entry_id), ...(inv.data || []).map(i => i.import_entry_id)].filter(Boolean)));
  const entries = entryIds.length ? await db.from('import_entries').select('id,boe_no,arrival_date').in('id', entryIds) : { data: [] as any[] };
  const entry = new Map((entries.data || []).map((e: any) => [e.id, e]));
  const rn = Array.from(new Set((links.data || []).map(l => l.ref_key)));
  const rec = rn.length ? await db.from('ops_purchase_receipts').select('rn_no,weight,bill_qty').in('rn_no', rn) : { data: [] as any[] };
  const tons = new Map((rec.data || []).map((r: any) => [r.rn_no, Number(r.weight ?? r.bill_qty ?? 0)]));
  return contracts.map(c => {
    const mine = (inv.data || []).filter(i => i.contract_id === c.id);
    const linked = entry.get(c.import_entry_id);
    const boeCount = mine.length ? mine.filter(i => i.boe_no || entry.get(i.import_entry_id)?.boe_no).length : linked?.boe_no ? 1 : 0;
    return {
      id: c.id, ref: c.contract_number, supplier: c.supplier_name, status: c.status, createdAt: c.created_at, entryId: c.import_entry_id,
      quantity: c.quantity == null ? null : Number(c.quantity), shipmentEnd: c.shipment_end_date, eta: c.eta_date || linked?.arrival_date || null, delivery: c.delivery_date, settlementDue: c.settlement_due_date, settledAt: c.settled_at,
      receivedTons: Math.round((links.data || []).filter(l => l.contract_id === c.id).reduce((a, l) => a + (tons.get(l.ref_key) || 0), 0) * 1000) / 1000,
      invoices: Math.max(mine.length, linked ? 1 : 0), invoicesWithBoe: boeCount, hasPurchaseVoucher: null,
    };
  });
}

export async function buildImportStatus(db: Db, today = istToday()): Promise<ImportStatus> {
  const [ent, con, facts] = await Promise.all([
    db.from('import_entries').select('*,trade_parties(name,country),trade_commodities(*)').neq('status', 'closed').order('created_at'),
    db.from('import_contracts').select('id,contract_number,supplier_name,status,created_at,import_entry_id'),
    loadAlertFacts(db).catch(() => []),
  ]);
  if (ent.error) throw ent.error;
  const records: RecordStatus[] = (ent.data || []).map((e: any) => {
    const miss = missingFields(e, today);
    return { id: e.id, refCode: e.ref_code, commodityId: e.commodity_id ?? null, supplier: e.trade_parties?.name || '—', contractNo: e.contract_no, status: e.status, due: miss.filter(m => m.due), later: miss.filter(m => !m.due) };
  });
  const contracts = con.error ? [] : con.data || [];
  const age = (c: string) => Math.max(0, Math.floor((Date.parse(today) - Date.parse(c.slice(0, 10))) / 86400000));
  const alerts = facts.flatMap(f => contractAlerts(f, today).filter(a => a.key !== 'review').map(a => ({ ...a, contractId: f.id })));
  return {
    today, openRecords: records.length, records,
    recordsNeedingInput: records.filter(r => r.due.length).length, fieldsNeeded: records.reduce((a, r) => a + r.due.length, 0),
    pendingContracts: contracts.filter(c => c.status !== 'Confirmed').map(c => ({ id: c.id, ref: c.contract_number, supplier: c.supplier_name, waitingDays: age(c.created_at) })),
    contractsWithoutRecord: contracts.filter(c => c.status === 'Confirmed' && !c.import_entry_id).map(c => ({ id: c.id, ref: c.contract_number, supplier: c.supplier_name })),
    alerts,
  };
}

export const stageName = (s: string) => (STAGE_LABEL as Record<string, string>)[s] || s;
