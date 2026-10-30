import { supabaseAdmin } from '@/lib/supabase/admin';

/** Upserts an ops_lots row and appends one ops_entity_timeline event — the
 * one place lot lifecycle status moves forward. Never moves status
 * backward (e.g. a re-uploaded weighment for an already-QC'd lot doesn't
 * regress its status to WEIGHED). */
const STATUS_ORDER = ['AWAITING_MATERIAL', 'AT_GATE', 'WEIGHED', 'RECEIPT_CREATED', 'LOT_CREATED', 'QC_PENDING', 'QC_COMPLETED', 'SETTLEMENT_PENDING', 'STOCK_POSTED', 'COMPLETED'];

export async function advanceLot(lotNo: string, status: string, description: string, extra?: { poNo?: string; gatePassNo?: string; supplierName?: string; productId?: string | null }): Promise<void> {
  if (!lotNo) return;
  const db = supabaseAdmin();
  const { data: existing } = await db.from('ops_lots').select('id,status').eq('lot_no', lotNo).maybeSingle();
  const newRank = STATUS_ORDER.indexOf(status);
  if (existing) {
    const currentRank = STATUS_ORDER.indexOf((existing as any).status);
    if (newRank > currentRank) await db.from('ops_lots').update({ status, updated_at: new Date().toISOString(), ...(extra?.poNo ? { po_no: extra.poNo } : {}), ...(extra?.gatePassNo ? { gate_pass_no: extra.gatePassNo } : {}), ...(extra?.supplierName ? { supplier_name: extra.supplierName } : {}), ...(extra?.productId ? { product_id: extra.productId } : {}) }).eq('id', (existing as any).id);
  } else {
    await db.from('ops_lots').insert({ lot_no: lotNo, status, po_no: extra?.poNo || null, gate_pass_no: extra?.gatePassNo || null, supplier_name: extra?.supplierName || null, product_id: extra?.productId || null });
  }
  await db.from('ops_entity_timeline').insert({ entity_type: 'LOT', entity_id: lotNo, event_type: status, description });
}

export type LotChainGap = { lotNo: string; exceptionType: 'lot_missing_weighment' | 'weighment_missing_gate_in' | 'gate_weighment_vehicle_mismatch'; gatePassNo?: string; description: string };

/** Confirms the real chain — PO -> Gate In -> Weighment (the bridge row
 * carrying gate_pass_no + po_no + lot_no together) -> a lot's downstream
 * QC/Settlement/Receipt rows — actually holds for each lot, instead of
 * silently allowing a lot to exist with no upstream gate/weighment record
 * (materially impossible: nothing can be lab-tested before it enters the
 * gate). Flags gaps for review rather than blocking the upload, since files
 * legitimately arrive out of order day to day. */
export async function checkLotChainIntegrity(lotNos: string[]): Promise<LotChainGap[]> {
  const uniqueLots = [...new Set(lotNos.filter(Boolean))];
  if (!uniqueLots.length) return [];
  const db = supabaseAdmin();
  const { data: weighRows } = await db.from('ops_weighments').select('lot_no,gate_pass_no,vehicle_no').in('lot_no', uniqueLots).eq('direction', 'IN');
  const weighByLot = new Map((weighRows || []).map((w: any) => [w.lot_no, w]));

  const gaps: LotChainGap[] = [];
  const gatePassNos = [...new Set((weighRows || []).map((w: any) => w.gate_pass_no).filter(Boolean))];
  const { data: gateRows } = gatePassNos.length ? await db.from('ops_gate_movements').select('gate_pass_no,vehicle_no').in('gate_pass_no', gatePassNos).eq('direction', 'IN') : { data: [] as any[] };
  const gateByPass = new Map((gateRows || []).map((g: any) => [g.gate_pass_no, g]));

  for (const lotNo of uniqueLots) {
    const weigh = weighByLot.get(lotNo);
    if (!weigh) { gaps.push({ lotNo, exceptionType: 'lot_missing_weighment', description: `Lot ${lotNo} has no matching inward weighment (Time Office In) record — this lot cannot have physically arrived without one.` }); continue; }
    const gate = weigh.gate_pass_no ? gateByPass.get(weigh.gate_pass_no) : null;
    if (weigh.gate_pass_no && !gate) { gaps.push({ lotNo, exceptionType: 'weighment_missing_gate_in', gatePassNo: weigh.gate_pass_no, description: `Lot ${lotNo}'s weighment references gate pass ${weigh.gate_pass_no}, but no matching Gate In movement was found for it.` }); continue; }
    if (gate && weigh.vehicle_no && gate.vehicle_no && weigh.vehicle_no !== gate.vehicle_no) { gaps.push({ lotNo, exceptionType: 'gate_weighment_vehicle_mismatch', gatePassNo: weigh.gate_pass_no, description: `Lot ${lotNo}'s weighment records vehicle ${weigh.vehicle_no}, but Gate In movement ${weigh.gate_pass_no} recorded vehicle ${gate.vehicle_no} — a likely data-entry mismatch.` }); }
  }
  return gaps;
}
