import { supabaseAdmin } from '@/lib/supabase/admin';

// The AIX3 tool layer — every function here is a plain, typed, read-only
// query against already-computed/persisted tables (never raw high-volume
// transaction tables scanned live, never something an LLM free-hand
// queries). AIX3 calls these instead of being handed raw rows, so an
// answer is always traceable back to a real deterministic query. This is
// the "MCP-style tool layer" from the spec, implemented as plain async
// functions rather than a protocol server — there is no existing MCP
// server in this codebase and no second consumer that would justify one;
// a typed function layer gets the same guarantee (AIX3 never free-queries
// the database) with zero new infrastructure.

export type OpsFilters = { from?: string; to?: string; product?: string; supplier?: string; customer?: string; po?: string; so?: string; lot?: string; shift?: string; module?: string; status?: string; severity?: string };

export async function getDailyOperationsSummary(date?: string) {
  const db = supabaseAdmin();
  let q = db.from('ops_daily_control_summary').select('*').order('report_date', { ascending: false }).limit(1);
  if (date) q = db.from('ops_daily_control_summary').select('*').eq('report_date', date).limit(1);
  const { data } = await q;
  return (data || [])[0] || null;
}

/** FLOW metrics (feeding/production totals) are summed across the period;
 * SNAPSHOT metrics (stock closing value) use the LATEST row in the period,
 * never a sum — summing a closing-stock snapshot across days double-counts
 * the same physical material. See spec section 29. */
export async function getPeriodOperationsSummary(from: string, to: string) {
  const db = supabaseAdmin();
  const { data } = await db.from('ops_daily_control_summary').select('*').gte('report_date', from).lte('report_date', to).order('report_date', { ascending: true });
  const rows = data || [];
  if (!rows.length) return null;
  const latest = rows[rows.length - 1] as any;
  const sum = (key: string) => rows.reduce((s, r: any) => s + Number(r[key] || 0), 0);
  return {
    from, to, days: rows.length,
    feedingTotalMt: sum('feeding_total_weight_mt'),
    productionTotalMt: sum('production_total_qty_mt'),
    stockClosingValue: latest.stock_closing_value,          // snapshot — latest, not summed
    openExceptions: latest.open_exceptions_count,             // snapshot (current state)
    criticalExceptions: latest.critical_exceptions_count,
    openTickets: latest.open_erp_tickets_count,
    productionStockVarianceMt: sum('production_stock_variance_mt'),
  };
}

export async function getPoHistory(poNo: string) {
  const db = supabaseAdmin();
  const [{ data: po }, { data: timeline }] = await Promise.all([
    db.from('ops_purchase_orders').select('*').eq('po_no', poNo),
    db.from('ops_entity_timeline').select('*').eq('entity_type', 'PO').eq('entity_id', poNo).order('event_at', { ascending: true }),
  ]);
  return { orders: po || [], timeline: timeline || [] };
}

export type PoTraceGate = { gatePassNo: string; direction: string; movementDate: string | null; vehicleNo: string | null; hasWeighment: boolean; netWeight: number | null };
export type PoTraceLot = { lotNo: string; status: string; supplierName: string | null; productId: string | null; qcResults: any[]; settlements: any[]; fed: boolean; fedDate: string | null; creditDebitNotes: any[] };
export type PoTracePayment = { matched: boolean; status?: string; actual?: number | null; paymentDate?: string | null; vendor?: string | null; matchedLot?: string | null };
export type PoTrace = { po: any[]; gateMovements: PoTraceGate[]; lots: PoTraceLot[]; payment: PoTracePayment };

/** Full PO → Gate In → Weighment → Lot → QC → Settlement → Feeding →
 * Payment trace for a single PO number, for the Supply page's "Trace"
 * drawer. Every stage is a live read across existing tables joined by the
 * keys they already carry (po_no on gate movements/lots; gate_pass_no
 * linking gate↔weighment; lot_no linking lot↔QC↔settlement↔feeding↔credit-
 * debit-notes) — no new columns, no new write path. Two independent
 * payment signals are surfaced, deliberately never merged into one: (1)
 * `creditDebitNotes` per lot — Operations' own Credit/Debit Note upload,
 * automatic, works even if Finance hasn't reconciled anything yet; (2)
 * `payment` — matched against the most recent vendor-payment reconciliation
 * run's persisted vendorPayments (each row already carries a matchedLot —
 * see app/api/reconcile/amount/route.ts), Finance's own process.
 * payment_reconciliation (the schema table of that name) is never written
 * by any code path and is deliberately not used here. */
export async function getPoTrace(poNo: string): Promise<PoTrace> {
  const db = supabaseAdmin();
  const [{ data: poRows }, { data: gateRows }, { data: lotRows }] = await Promise.all([
    db.from('ops_purchase_orders').select('*').eq('po_no', poNo),
    db.from('ops_gate_movements').select('gate_pass_no,direction,movement_date,vehicle_no').eq('po_no', poNo).order('movement_date', { ascending: true }),
    db.from('ops_lots').select('lot_no,status,supplier_name,product_id').eq('po_no', poNo),
  ]);

  const gatePassNos = (gateRows || []).map((g: any) => g.gate_pass_no);
  const { data: weighRows } = gatePassNos.length ? await db.from('ops_weighments').select('gate_pass_no,net_weight').in('gate_pass_no', gatePassNos).eq('direction', 'IN') : { data: [] as any[] };
  const weighByPass = new Map((weighRows || []).map((w: any) => [w.gate_pass_no, w.net_weight]));
  const gateMovements: PoTraceGate[] = (gateRows || []).map((g: any) => ({ gatePassNo: g.gate_pass_no, direction: g.direction, movementDate: g.movement_date, vehicleNo: g.vehicle_no, hasWeighment: weighByPass.has(g.gate_pass_no), netWeight: weighByPass.get(g.gate_pass_no) ?? null }));

  const lotNos = (lotRows || []).map((l: any) => l.lot_no);
  const [{ data: qcRows }, { data: settleRows }, { data: feedRows }, { data: cdRows }] = await Promise.all([
    lotNos.length ? db.from('ops_qc_results').select('lot_no,sample_code,report_date,oil,ffa,fiber,iv,moi,protein,ss').in('lot_no', lotNos) : Promise.resolve({ data: [] as any[] }),
    lotNos.length ? db.from('ops_settlements').select('lot_no,reference_no,inward_date,quantity,oil,ffa').in('lot_no', lotNos) : Promise.resolve({ data: [] as any[] }),
    lotNos.length ? db.from('ops_feeding_entries').select('lot_no,report_date').in('lot_no', lotNos) : Promise.resolve({ data: [] as any[] }),
    lotNos.length ? db.from('ops_credit_debit_notes').select('lot_no,reference_number,net_value,bill_value,date').in('lot_no', lotNos) : Promise.resolve({ data: [] as any[] }),
  ]);
  const fedDateByLot = new Map((feedRows || []).map((f: any) => [f.lot_no, f.report_date]));
  const qcByLot = new Map<string, any[]>();
  for (const r of qcRows || []) { const key = (r as any).lot_no; const arr = qcByLot.get(key) || []; arr.push(r); qcByLot.set(key, arr); }
  const settleByLot = new Map<string, any[]>();
  for (const r of settleRows || []) { const key = (r as any).lot_no; const arr = settleByLot.get(key) || []; arr.push(r); settleByLot.set(key, arr); }
  const cdByLot = new Map<string, any[]>();
  for (const r of cdRows || []) { const key = (r as any).lot_no; const arr = cdByLot.get(key) || []; arr.push(r); cdByLot.set(key, arr); }
  const lots: PoTraceLot[] = (lotRows || []).map((l: any) => ({ lotNo: l.lot_no, status: l.status, supplierName: l.supplier_name, productId: l.product_id, qcResults: qcByLot.get(l.lot_no) || [], settlements: settleByLot.get(l.lot_no) || [], fed: fedDateByLot.has(l.lot_no), fedDate: fedDateByLot.get(l.lot_no) ?? null, creditDebitNotes: cdByLot.get(l.lot_no) || [] }));

  let payment: PoTracePayment = { matched: false };
  if (lotNos.length) {
    const { data: runs } = await db.from('reconciliation_runs').select('summary').eq('reconciliation_type', 'vendor_payment').order('created_at', { ascending: false }).limit(5);
    for (const run of runs || []) {
      const vendorPayments: any[] = (run as any).summary?.downloadReport?.vendorPayments || [];
      const hit = vendorPayments.find((v: any) => lotNos.includes(v.matchedLot));
      if (hit) { payment = { matched: true, status: hit.status, actual: hit.actual ?? null, paymentDate: hit.paymentDate ?? null, vendor: hit.vendor ?? null, matchedLot: hit.matchedLot }; break; }
    }
  }

  return { po: poRows || [], gateMovements, lots, payment };
}

export async function getSoHistory(soNo: string) {
  const db = supabaseAdmin();
  const [{ data: so }, { data: timeline }] = await Promise.all([
    db.from('ops_sales_orders').select('*').eq('so_no', soNo),
    db.from('ops_entity_timeline').select('*').eq('entity_type', 'SO').eq('entity_id', soNo).order('event_at', { ascending: true }),
  ]);
  return { orders: so || [], timeline: timeline || [] };
}

export async function getLotHistory(lotNo: string) {
  const db = supabaseAdmin();
  const [{ data: lot }, { data: qc }, { data: timeline }] = await Promise.all([
    db.from('ops_lots').select('*').eq('lot_no', lotNo).maybeSingle(),
    db.from('ops_qc_results').select('*').eq('lot_no', lotNo),
    db.from('ops_entity_timeline').select('*').eq('entity_type', 'LOT').eq('entity_id', lotNo).order('event_at', { ascending: true }),
  ]);
  return { lot: lot || null, qcResults: qc || [], timeline: timeline || [] };
}

export async function getProductStockHistory(productId: string, from: string, to: string) {
  const db = supabaseAdmin();
  const { data: batches } = await db.from('ops_upload_batches').select('id,report_date').eq('report_type', 'stock_snapshot').eq('is_active', true).gte('report_date', from).lte('report_date', to);
  const batchIds = (batches || []).map((b: any) => b.id);
  if (!batchIds.length) return [];
  const { data } = await db.from('ops_stock_snapshots').select('opening_qty,inward_qty,outward_qty,closing_qty,upload_batch_id').eq('product_id', productId).in('upload_batch_id', batchIds);
  const byBatch = new Map((batches || []).map((b: any) => [b.id, b.report_date]));
  return (data || []).map((r: any) => ({ reportDate: byBatch.get(r.upload_batch_id), ...r }));
}

export async function getProductionHistory(productId: string, from: string, to: string) {
  const db = supabaseAdmin();
  const { data } = await db.from('ops_production_entries').select('report_date,shift,packing,quantity').eq('product_id', productId).gte('report_date', from).lte('report_date', to).order('report_date');
  return data || [];
}

export async function getSupplierPerformance(supplierName: string, from: string, to: string) {
  const db = supabaseAdmin();
  const [{ data: pos }, { data: qc }] = await Promise.all([
    db.from('ops_purchase_orders').select('po_no,ordered_qty,received_qty,pending_qty,status').ilike('supplier_name', supplierName).gte('po_date', from).lte('po_date', to),
    db.from('ops_qc_results').select('lot_no,oil,ffa').ilike('supplier_name', supplierName).gte('report_date', from).lte('report_date', to),
  ]);
  return { purchaseOrders: pos || [], qcResults: qc || [] };
}

export async function getOpenExceptions(filters: OpsFilters) {
  const db = supabaseAdmin();
  let q = db.from('ops_exceptions').select('id,exception_type,severity,report_date,module,description,status,product_id').order('report_date', { ascending: false }).limit(200);
  if (filters.from) q = q.gte('report_date', filters.from);
  if (filters.to) q = q.lte('report_date', filters.to);
  if (filters.module) q = q.eq('module', filters.module);
  if (filters.severity) q = q.eq('severity', filters.severity);
  q = q.eq('status', filters.status || 'open');
  const { data } = await q;
  return data || [];
}

export async function getTicketHistory(reference: string) {
  const db = supabaseAdmin();
  const { data } = await db.from('deviation_tickets').select('id,ticket_no,status,created_at,closed_at,ops_exceptions(exception_type,severity,description,report_date)').ilike('ticket_no', `%${reference}%`).not('ops_exception_id', 'is', null).order('created_at', { ascending: false }).limit(50);
  return data || [];
}

export async function getManagementBriefs(from: string, to: string) {
  const db = supabaseAdmin();
  const { data } = await db.from('ops_management_briefs').select('report_date,brief').gte('report_date', from).lte('report_date', to).order('report_date', { ascending: false });
  return data || [];
}

export async function getEntityTimeline(entityType: string, entityId: string) {
  const db = supabaseAdmin();
  const { data } = await db.from('ops_entity_timeline').select('*').eq('entity_type', entityType.toUpperCase()).eq('entity_id', entityId).order('event_at', { ascending: true });
  return data || [];
}
