import { supabaseAdmin } from '@/lib/supabase/admin';
import { normalizeVehicle } from '@/lib/reconciliation/normalize';
import type { CdnRec, EvidenceBundle, LotRec, PoRec, Prov, QcRec, ReceiptRec, SaleOrderRec, SalesInvoiceRec, SettlementRec, TimeOfficeRec } from './records';

// Uploaded records take priority for any key they cover; the Operations
// database is consulted only for keys the uploads don't contain. Every DB
// record carries its table + row id and the file it originally came from
// (via ops_upload_batches), so provenance is uniform across both sources.

const chunk = <T,>(a: T[], n = 150): T[][] => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const up = (s: unknown) => String(s ?? '').trim().toUpperCase();
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

async function fetchIn(table: string, select: string, col: string, values: string[]): Promise<any[]> {
  const uniq = [...new Set(values.filter(Boolean))];
  if (!uniq.length) return [];
  const db = supabaseAdmin();
  const out: any[] = [];
  for (const part of chunk(uniq)) { const { data } = await db.from(table).select(select).in(col, part); if (data) out.push(...data); }
  return out;
}

export type Evidence = {
  lots: LotRec[];
  receiptsByLot: Map<string, ReceiptRec[]>; receiptsByPo: Map<string, ReceiptRec[]>;
  qcByLot: Map<string, QcRec[]>; settlementsByLot: Map<string, SettlementRec[]>; cdnByLot: Map<string, CdnRec[]>;
  salesInvoicesBySo: Map<string, SalesInvoiceRec[]>; salesInvoiceByNo: Map<string, SalesInvoiceRec[]>; salesInvoicesByVehicle: Map<string, SalesInvoiceRec[]>;
  saleOrderBySo: Map<string, SaleOrderRec>; poByNo: Map<string, PoRec>; timeOfficeByGp: Map<string, TimeOfficeRec>;
};

const group = <T,>(items: T[], key: (t: T) => string): Map<string, T[]> => { const m = new Map<string, T[]>(); for (const t of items) { const k = key(t); if (!k) continue; (m.get(k) || m.set(k, []).get(k)!).push(t); } return m; };
/** union keyed groups, uploaded group wins for a key it has. */
function overlay<T>(uploaded: T[], fromDb: T[], key: (t: T) => string): T[] {
  const upKeys = new Set(uploaded.map(key).filter(Boolean));
  return [...uploaded, ...fromDb.filter(t => !upKeys.has(key(t)))];
}

/** Phase 1: which Operations/uploaded lots could a (short) weighment lot
 * refer to? Returned records are matched by the caller on a "/"-separated
 * segment, never a substring. */
export async function loadLotUniverse(bundle: EvidenceBundle, tokens: string[]): Promise<LotRec[]> {
  const t = [...new Set(tokens.filter(x => x.length >= 4 && /^[A-Z0-9\-/.]+$/.test(x)))];
  const uploaded = bundle.lots.filter(l => t.some(x => up(l.lotNo) === x || up(l.lotNo).split('/').includes(x)));
  if (!t.length) return uploaded;
  const db = supabaseAdmin();
  const { data } = await db.from('ops_lots').select('id,lot_no,product_id,po_no,upload_batch_id').or(t.map(x => `lot_no.ilike.%${x}%`).join(','));
  const fromDb: LotRec[] = (data || []).filter((r: any) => { const l = up(r.lot_no); return t.some(x => l === x || l.split('/').includes(x)); }).map((r: any) => ({ lotNo: r.lot_no, poNo: r.po_no || '', productId: r.product_id, productRaw: null, prov: { origin: 'operations_db', file: 'Operations database', sheet: 'ops_lots', row: `id ${r.id}` } }));
  return overlay(uploaded, fromDb, l => up(l.lotNo));
}

export type Needs = { lots: string[]; poNos: string[]; soNos: string[]; invoiceNos: string[]; gatePasses: string[]; vehicles?: string[] };

/** Phase 2: everything downstream of the resolved lots / PO / SO / invoice. */
export async function loadEvidence(bundle: EvidenceBundle, needs: Needs, lotUniverse: LotRec[]): Promise<Evidence> {
  const lots = needs.lots, pos = needs.poNos, sos = needs.soNos, inv = needs.invoiceNos, gps = needs.gatePasses, vehicles = needs.vehicles || [];
  const [rcpLot, rcpPo, qc, st, cdn, siSo, siNo, so, po, tof, siVeh] = await Promise.all([
    fetchIn('ops_purchase_receipts', 'id,upload_batch_id,rn_no,rn_date,po_no,lot_no,supplier_name,vehicle_no,product_raw,bill_no,bill_rate,bill_qty,bill_value,weight,jute_bag,plastic_bag,total_bags', 'lot_no', lots),
    fetchIn('ops_purchase_receipts', 'id,upload_batch_id,rn_no,rn_date,po_no,lot_no,supplier_name,vehicle_no,product_raw,bill_no,bill_rate,bill_qty,bill_value,weight,jute_bag,plastic_bag,total_bags', 'po_no', pos),
    fetchIn('ops_qc_results', 'id,upload_batch_id,reference_no,lot_no,report_date,sample_code,oil', 'lot_no', lots),
    fetchIn('ops_settlements', 'id,upload_batch_id,reference_no,lot_no,inward_date,quantity,oil', 'lot_no', lots),
    fetchIn('ops_credit_debit_notes', 'id,upload_batch_id,reference_number,po_no,lot_no,invoice_no,date,purchase_type,customer_name,jute_bag,pack_rate,pack_cost,advance,net_weight,final_weight,lab_oil,rep_oil,bill_rate,final_rate,bill_value,rebate_value,rebate_net_value,net_value,value,sgst,cgst,igst,total_gst,rebate_igst,rebate_cgst,rebate_sgst,weightment,unloading,tds', 'lot_no', lots),
    fetchIn('ops_sales_invoices', 'id,upload_batch_id,invoice_no,so_no,invoice_date,party_name,place,vehicle_no,product_raw,packing_size,quantity_mt,quantity_kg,rate,amount,tax_amount,total_invoice_amount', 'so_no', sos),
    fetchIn('ops_sales_invoices', 'id,upload_batch_id,invoice_no,so_no,invoice_date,party_name,place,vehicle_no,product_raw,packing_size,quantity_mt,quantity_kg,rate,amount,tax_amount,total_invoice_amount', 'invoice_no', inv),
    fetchIn('ops_sales_orders', 'id,upload_batch_id,so_no,so_date,customer_name,product_raw,quantity,rate,status', 'so_no', sos),
    fetchIn('ops_purchase_orders', 'id,upload_batch_id,po_no,po_date,supplier_name,product_raw,ordered_qty,rate', 'po_no', pos),
    fetchIn('ops_weighments', 'id,upload_batch_id,gate_pass_no,lot_no,po_no,vehicle_no,gross_weight,tare_weight,net_weight,gunny_bags,plastic_bags,total_bags', 'gate_pass_no', gps),
    fetchIn('ops_sales_invoices', 'id,upload_batch_id,invoice_no,so_no,invoice_date,party_name,place,vehicle_no,product_raw,packing_size,quantity_mt,quantity_kg,rate,amount,tax_amount,total_invoice_amount', 'vehicle_no', vehicles),
  ]);

  const batchIds = [...new Set([rcpLot, rcpPo, qc, st, cdn, siSo, siNo, so, po, tof, siVeh].flat().map((r: any) => r.upload_batch_id).filter(Boolean))];
  const batches = new Map((await fetchIn('ops_upload_batches', 'id,file_name', 'id', batchIds)).map((b: any) => [b.id, b.file_name as string]));
  const P = (table: string, r: any): Prov => ({ origin: 'operations_db', file: batches.get(r.upload_batch_id) || 'Operations database', sheet: table, row: `id ${r.id}` });

  const dbReceipts: ReceiptRec[] = [...rcpLot, ...rcpPo].filter((r, i, a) => a.findIndex(x => x.id === r.id) === i).map(r => ({ rnNo: r.rn_no, rnDate: r.rn_date || '', poNo: r.po_no || '', lotNo: r.lot_no || '', supplier: r.supplier_name || '', vehicle: r.vehicle_no || '', product: r.product_raw || '', billNo: r.bill_no || '', billRate: num(r.bill_rate), billQty: num(r.bill_qty), weight: num(r.weight), billValue: num(r.bill_value), juteBag: num(r.jute_bag), plasticBag: num(r.plastic_bag), totalBags: num(r.total_bags), prov: P('ops_purchase_receipts', r) }));
  const dbQc: QcRec[] = qc.map(r => ({ referenceNo: r.reference_no || '', lotNo: r.lot_no, date: r.report_date || '', sampleCode: r.sample_code, oil: num(r.oil), prov: P('ops_qc_results', r) }));
  const dbSt: SettlementRec[] = st.map(r => ({ referenceNo: r.reference_no, lotNo: r.lot_no || '', date: r.inward_date || '', quantity: num(r.quantity), oil: num(r.oil), prov: P('ops_settlements', r) }));
  const dbCdn: CdnRec[] = cdn.map(r => ({ referenceNumber: r.reference_number, poNo: r.po_no || '', lotNo: r.lot_no || '', invoiceNo: r.invoice_no || '', date: r.date || '', purchaseType: r.purchase_type || '', customerName: r.customer_name || '', juteBag: num(r.jute_bag), packRate: num(r.pack_rate), packCost: num(r.pack_cost), advance: num(r.advance), netWeight: num(r.net_weight), finalWeight: num(r.final_weight), labOil: num(r.lab_oil), repOil: num(r.rep_oil), billRate: num(r.bill_rate), finalRate: num(r.final_rate), billValue: num(r.bill_value), rebateValue: num(r.rebate_value), rebateNetValue: num(r.rebate_net_value), netValue: num(r.net_value), value: num(r.value), sgst: num(r.sgst), cgst: num(r.cgst), igst: num(r.igst), totalGst: num(r.total_gst), rebateIgst: num(r.rebate_igst), rebateCgst: num(r.rebate_cgst), rebateSgst: num(r.rebate_sgst), weightment: num(r.weightment), unloading: num(r.unloading), tds: num(r.tds), prov: P('ops_credit_debit_notes', r) }));
  const dbSi: SalesInvoiceRec[] = [...siSo, ...siNo, ...siVeh].filter((r, i, a) => a.findIndex(x => x.id === r.id) === i).map(r => ({ invoiceNo: r.invoice_no, soNo: r.so_no || '', date: r.invoice_date || '', party: r.party_name || '', vehicle: r.vehicle_no || '', product: r.product_raw || '', qtyMt: num(r.quantity_mt), qtyKg: num(r.quantity_kg), packing: r.packing_size || '', rate: num(r.rate), amount: num(r.amount), totalInvoiceAmount: num(r.total_invoice_amount), place: r.place || '', taxAmount: num(r.tax_amount), prov: P('ops_sales_invoices', r) }));
  const dbSo: SaleOrderRec[] = so.map(r => ({ soNo: r.so_no, date: r.so_date || '', customer: r.customer_name || '', product: r.product_raw || '', quantity: num(r.quantity), rate: num(r.rate), status: r.status || '', prov: P('ops_sales_orders', r) }));
  const dbPo: PoRec[] = po.map(r => ({ poNo: r.po_no, date: r.po_date || '', supplier: r.supplier_name || '', product: r.product_raw || '', orderedQty: num(r.ordered_qty), rate: num(r.rate), prov: P('ops_purchase_orders', r) }));
  const dbTof: TimeOfficeRec[] = tof.map(r => ({ gatePassNo: r.gate_pass_no, lotNo: r.lot_no || '', poNo: r.po_no || '', vehicle: r.vehicle_no || '', gross: num(r.gross_weight), tare: num(r.tare_weight), net: num(r.net_weight), gunnyBags: num(r.gunny_bags), plasticBags: num(r.plastic_bags), totalBags: num(r.total_bags), prov: P('ops_weighments', r) }));

  const receipts = overlay(bundle.receipts, dbReceipts, r => up(r.lotNo) || up(r.rnNo));
  const salesInvoices = overlay(bundle.salesInvoices, dbSi, r => up(r.invoiceNo));
  const cdnAll = overlay(bundle.cdn, dbCdn, r => up(r.lotNo));
  const posAll = overlay(bundle.pos, dbPo, r => up(r.poNo));
  return {
    lots: lotUniverse,
    receiptsByLot: group(receipts, r => up(r.lotNo)), receiptsByPo: group(receipts, r => up(r.poNo)),
    qcByLot: group(overlay(bundle.qc, dbQc, r => up(r.lotNo)), r => up(r.lotNo)),
    settlementsByLot: group(overlay(bundle.settlements, dbSt, r => up(r.lotNo)), r => up(r.lotNo)),
    cdnByLot: group(cdnAll, r => up(r.lotNo)),
    salesInvoicesBySo: group(salesInvoices, r => up(r.soNo)), salesInvoiceByNo: group(salesInvoices, r => up(r.invoiceNo)), salesInvoicesByVehicle: group(salesInvoices, r => normalizeVehicle(r.vehicle)),
    saleOrderBySo: new Map(overlay(bundle.saleOrders, dbSo, r => up(r.soNo)).map(r => [up(r.soNo), r])),
    poByNo: new Map(posAll.map(r => [up(r.poNo), r])),
    timeOfficeByGp: new Map(overlay(bundle.timeOffice, dbTof, r => up(r.gatePassNo)).map(r => [up(r.gatePassNo), r])),
  };
}

/** Gate pass -> lot, from Time Office In (uploaded first, else the Operations
 * weighments table) — the bridge the real chain uses (Gate carries the PO, the
 * Time Office row carries gate pass + lot). */
export async function loadGateBridge(bundle: EvidenceBundle, gatePasses: string[]): Promise<Map<string, { lotNo: string; prov: Prov }>> {
  const out = new Map<string, { lotNo: string; prov: Prov }>();
  const uploaded = bundle.timeOffice.filter(t => t.lotNo);
  const upSet = new Set(uploaded.map(t => up(t.gatePassNo)));
  for (const t of uploaded) if (gatePasses.map(up).includes(up(t.gatePassNo))) out.set(up(t.gatePassNo), { lotNo: t.lotNo, prov: t.prov });
  const rows = await fetchIn('ops_weighments', 'id,gate_pass_no,lot_no', 'gate_pass_no', gatePasses.filter(g => !upSet.has(up(g))));
  for (const r of rows) if (r.lot_no) out.set(up(r.gate_pass_no), { lotNo: r.lot_no, prov: { origin: 'operations_db', file: 'Operations database', sheet: 'ops_weighments', row: `id ${r.id}` } });
  return out;
}

/** Time Office net weight per gate pass for a set of CANDIDATE gate passes (before any is chosen), uploaded first, else the
 * Operations weighments table. Used only to break a tie between gate passes of the same vehicle — see engine.ts. The net is
 * returned as stored (the report prints MT; the engine compares it to the weighbridge kg either way). */
export async function loadTimeOfficeNets(bundle: EvidenceBundle, gatePasses: string[]): Promise<Map<string, { net: number; lotNo: string }>> {
  const out = new Map<string, { net: number; lotNo: string }>();
  const wanted = new Set(gatePasses.map(up));
  const uploaded = bundle.timeOffice.filter(t => t.net != null && wanted.has(up(t.gatePassNo)));
  for (const t of uploaded) out.set(up(t.gatePassNo), { net: t.net as number, lotNo: t.lotNo });
  const rows = await fetchIn('ops_weighments', 'gate_pass_no,lot_no,net_weight', 'gate_pass_no', [...wanted].filter(g => !out.has(g)));
  for (const r of rows) { const n = num(r.net_weight); if (n != null) out.set(up(r.gate_pass_no), { net: n, lotNo: r.lot_no || '' }); }
  return out;
}

/** Every ERP purchase receipt dated inside [from, to] (uploaded Purchase Register first, then the Operations database), so
 * receipts that have no weighment row can be listed instead of silently never appearing in the reconciliation. */
export async function loadReceiptsInRange(bundle: EvidenceBundle, from: string, to: string): Promise<ReceiptRec[]> {
  const uploaded = bundle.receipts.filter(r => r.rnDate >= from && r.rnDate <= to);
  const db = supabaseAdmin();
  const rows: any[] = [];
  for (let i = 0; ; i += 1000) {
    const { data } = await db.from('ops_purchase_receipts').select('id,upload_batch_id,rn_no,rn_date,po_no,lot_no,supplier_name,vehicle_no,product_raw,bill_no,bill_rate,bill_qty,bill_value,weight,jute_bag,plastic_bag,total_bags').gte('rn_date', from).lte('rn_date', to).order('rn_no').range(i, i + 999);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  const batches = new Map((await fetchIn('ops_upload_batches', 'id,file_name', 'id', [...new Set(rows.map(r => r.upload_batch_id).filter(Boolean))])).map((b: any) => [b.id, b.file_name as string]));
  const fromDb: ReceiptRec[] = rows.map(r => ({ rnNo: r.rn_no, rnDate: r.rn_date || '', poNo: r.po_no || '', lotNo: r.lot_no || '', supplier: r.supplier_name || '', vehicle: r.vehicle_no || '', product: r.product_raw || '', billNo: r.bill_no || '', billRate: num(r.bill_rate), billQty: num(r.bill_qty), weight: num(r.weight), billValue: num(r.bill_value), juteBag: num(r.jute_bag), plasticBag: num(r.plastic_bag), totalBags: num(r.total_bags), prov: { origin: 'operations_db', file: batches.get(r.upload_batch_id) || 'Operations database', sheet: 'ops_purchase_receipts', row: `id ${r.id}` } }));
  return overlay(uploaded, fromDb, r => up(r.rnNo));
}
