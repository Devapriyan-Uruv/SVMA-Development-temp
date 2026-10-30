import type { supabaseAdmin } from '@/lib/supabase/admin';
import { nextRefCode } from '@/lib/trade';
import { missingFields } from './master';
import { istToday } from './status';
import { notifyRecordCreated } from './notify';

type Db = ReturnType<typeof supabaseAdmin>;
const isoDate = (v: unknown): string | null => {
  const s = String(v ?? '').trim(); if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const t = Date.parse(s); return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
};

/** A confirmed contract becomes an Import record (Import Master row) with its contract fields filled; the rest is asked of the data owner.
 * Safe to call again: a contract that already has a record keeps it. */
export async function ensureImportEntry(db: Db, contractId: string, userId: string | null): Promise<{ entryId: string; refCode: string; created: boolean } | null> {
  const { data: c, error } = await db.from('import_contracts').select('*').eq('id', contractId).maybeSingle();
  if (error) throw error;
  if (!c) return null;
  if (c.import_entry_id) { const { data: e } = await db.from('import_entries').select('ref_code').eq('id', c.import_entry_id).maybeSingle(); if (e) return { entryId: c.import_entry_id, refCode: e.ref_code, created: false }; }

  // Supplier: reuse a party of the same name, otherwise add it.
  const { data: parties } = await db.from('trade_parties').select('id,name').ilike('name', c.supplier_name);
  let partyId = parties?.find(p => p.name.trim().toLowerCase() === String(c.supplier_name).trim().toLowerCase())?.id as string | undefined;
  if (!partyId) {
    const { data: np, error: pe } = await db.from('trade_parties').insert({ party_type: 'supplier', name: String(c.supplier_name).trim(), country: c.supplier_country || null, created_by: userId }).select('id').single();
    if (pe) throw pe; partyId = np.id;
  }
  // Commodity: the closest existing name, otherwise add it.
  const product = String(c.product_material_name || '').trim();
  const { data: commodities } = await db.from('trade_commodities').select('id,name').eq('active', true);
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  let commodityId = (commodities || []).find(x => norm(x.name) === norm(product))?.id ?? (commodities || []).find(x => product && (norm(product).includes(norm(x.name)) || norm(x.name).includes(norm(product))))?.id;
  if (commodityId == null) {
    const { data: nc, error: ce } = await db.from('trade_commodities').insert({ name: product || 'Unspecified', unit: 'MT', active: true }).select('id').single();
    if (ce) throw ce; commodityId = nc.id;
  }
  const qty = c.quantity == null ? null : Number(c.uom === 'KG' ? Number(c.quantity) / 1000 : c.quantity);
  const refCode = await nextRefCode(db, 'import');
  const row = {
    ref_code: refCode, status: 'contract_received', created_by: userId, party_id: partyId, commodity_id: commodityId, country: c.supplier_country || null,
    contract_no: c.contract_number, contract_date: isoDate(c.contract_date), contract_qty: qty, rate_per_ton: c.unit_price, currency: c.currency || 'USD', contract_value_fcy: c.total_contract_value,
    payment_terms: c.payment_terms || null, shipment_period: c.shipment_date_period || null, port_of_loading: c.port_of_loading || null,
  };
  const { data: entry, error: ie } = await db.from('import_entries').insert(row).select('*,trade_parties(name,country),trade_commodities(*)').single();
  if (ie) throw ie;
  await db.from('import_contracts').update({ import_entry_id: entry.id, updated_at: new Date().toISOString() }).eq('id', contractId);
  const missing = missingFields(entry, istToday()).filter(m => m.due).length;
  await notifyRecordCreated(db, { id: entry.id, ref: refCode, contractNo: c.contract_number, supplier: c.supplier_name }, missing).catch(() => 0);
  return { entryId: entry.id, refCode, created: true };
}
