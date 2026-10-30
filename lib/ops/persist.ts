import { supabaseAdmin } from '@/lib/supabase/admin';
import { sha256Hex } from './normalize';
import { resolveProductIds } from './productMatch';
import { SNAPSHOT_REPORT_TYPES, type ParsedReport, type ReportType } from './parsers/index';
import { writeExceptions } from './exceptions';
import { advanceLot, checkLotChainIntegrity } from './entityTimeline';

export type UploadResult = {
  status: 'duplicate_file' | 'completed' | 'completed_with_errors';
  batchId: string | null;
  reportDate: string | null;
  versionNo: number;
  supersededBatchId: string | null;
  totalRowsInFile: number;
  newRowCount: number;
  duplicateRowCount: number;
  correctionFlaggedCount: number;
  message: string;
  existingBatch?: { id: string; reportDate: string | null; uploadedAt: string };
};

/** File-level duplicate check + batch record creation + raw file storage.
 * Mirrors app/api/tickets/evidence/route.ts's bucket/path convention. */
async function openBatch(reportType: ReportType, fileName: string, fileBuffer: Buffer, uploadedBy: string | null) {
  const db = supabaseAdmin();
  const fileSha256 = sha256Hex(fileBuffer);
  const { data: existing } = await db.from('ops_upload_batches').select('id,report_date,created_at,status').eq('report_type', reportType).eq('file_sha256', fileSha256).maybeSingle();
  if (existing && ['completed', 'completed_with_errors'].includes((existing as any).status)) return { batchId: null as string | null, duplicate: existing as any, inProgress: false };

  // A batch genuinely still being worked on right now (a second concurrent
  // upload of the identical file — e.g. a double "Process All" click, since
  // that button's own disabled-guard has a known gap — sql/frontend fix
  // alongside this one) must NOT be treated the same as one abandoned
  // mid-crash. Both share status='processing' with no separate heartbeat
  // column, so recency of created_at is what tells them apart: confirmed
  // live that without this check, the second request silently reused and
  // reset the first request's still-running batch row, so both proceeded to
  // insert the same rows in parallel — the actual cause of a raw
  // unique-constraint crash instead of a clean "already in progress" message.
  if (existing && (existing as any).status === 'processing') {
    const ageMs = Date.now() - new Date((existing as any).created_at).getTime();
    if (ageMs < 3 * 60_000) return { batchId: null as string | null, duplicate: existing as any, inProgress: true };
  }

  // A prior attempt for this exact file+type that never reached completed
  // (failed outright, or got stuck in 'processing' e.g. from a crashed
  // request, old enough that it's not a live concurrent request per the
  // check above) still occupies the unique(report_type, file_sha256) slot —
  // confirmed live that retrying such a file after fixing the underlying
  // cause hit a unique-constraint violation with no useful error. Reuse and
  // reset that row instead of inserting a fresh one.
  let batchId: string;
  if (existing) {
    batchId = (existing as any).id as string;
    // created_at is reset too, alongside status — that's what the recency
    // check above measures, so a reused row's "is this a live concurrent
    // request" clock restarts here rather than staying pinned to whenever
    // the original (now long-abandoned) attempt first ran.
    const { error: resetErr } = await db.from('ops_upload_batches').update({ status: 'processing', error_summary: [], file_name: fileName, file_size: fileBuffer.length, uploaded_by: uploadedBy, created_at: new Date().toISOString() }).eq('id', batchId);
    if (resetErr) throw new Error(`Could not reset the previous upload attempt for retry: ${resetErr.message}`);
  } else {
    const { data: batchRow, error: insertErr } = await db.from('ops_upload_batches').insert({ report_type: reportType, file_name: fileName, storage_path: '', file_sha256: fileSha256, file_size: fileBuffer.length, status: 'processing', uploaded_by: uploadedBy }).select('id').single();
    if (insertErr || !batchRow) throw new Error(`Could not create the ERP upload batch record: ${insertErr?.message || 'unknown error'}`);
    batchId = (batchRow as any).id as string;
  }

  const safeName = fileName.replace(/[^A-Za-z0-9._-]/g, '_');
  const storagePath = `${batchId}/${reportType}/${Date.now()}-${safeName}`;
  const { error: uploadErr } = await db.storage.from('svma-erp-raw').upload(storagePath, fileBuffer, { contentType: 'application/octet-stream', upsert: false });
  if (uploadErr) { await db.from('ops_upload_batches').update({ status: 'failed', error_summary: [{ message: uploadErr.message }] }).eq('id', batchId); throw new Error('Could not store the uploaded file.'); }
  await db.from('ops_upload_batches').update({ storage_path: storagePath }).eq('id', batchId);
  return { batchId, duplicate: null, inProgress: false };
}

/** Runs checkLotChainIntegrity for the lots touched by this call and writes
 * any gaps as exceptions — vehicle mismatches are a real data-entry problem
 * (warning, auto-tickets); a lot simply missing its weighment/gate record
 * is routine given files arrive out of order day to day (info, no ticket). */
async function reportLotChainGaps(lotNos: string[], reportDateByLot: Map<string, string | null>, fallbackReportDate: string) {
  const gaps = await checkLotChainIntegrity(lotNos).catch(() => []);
  if (!gaps.length) return;
  await writeExceptions(gaps.map(g => ({
    exceptionType: g.exceptionType,
    severity: g.exceptionType === 'gate_weighment_vehicle_mismatch' ? ('warning' as const) : ('info' as const),
    reportDate: reportDateByLot.get(g.lotNo) || fallbackReportDate,
    module: 'ops_supply',
    referenceIds: g.gatePassNo ? { lotNo: g.lotNo, gatePassNo: g.gatePassNo } : { lotNo: g.lotNo },
    description: g.description,
  }))).catch(() => {});
}

async function persistFeeding(batchId: string, rows: import('./parsers/feeding').ParsedFeedingRow[]) {
  const db = supabaseAdmin();
  const productIds = await resolveProductIds('feeding', rows.map(r => r.productRaw));
  const refs = [...new Set(rows.map(r => r.referenceNo))];
  // Business key is (reference_no, lot_no), NOT reference_no alone — confirmed
  // against the real file that "Reference No" is a per-SHIFT identifier that
  // genuinely repeats across every lot/product fed in that shift (see
  // sql/043_ops_feeding_composite_key_fix.sql for the live-test that caught this).
  const { data: existingRows } = await db.from('ops_feeding_entries').select('reference_no,lot_no,row_fingerprint').in('reference_no', refs);
  const existingByKey = new Map((existingRows || []).map((r: any) => [`${r.reference_no}|${r.lot_no}`, r.row_fingerprint]));
  let newRows = 0, duplicateRows = 0, correctionFlags = 0;
  const toInsert: any[] = []; const seenThisBatch = new Set<string>(); const corrections: { key: string; reportDate: string }[] = [];
  for (const r of rows) {
    const key = `${r.referenceNo}|${r.lotNo}`;
    if (seenThisBatch.has(key)) continue; // same lot repeated within one upload — keep the first occurrence only
    seenThisBatch.add(key);
    const existingFp = existingByKey.get(key);
    if (existingFp === undefined) {
      toInsert.push({ upload_batch_id: batchId, reference_no: r.referenceNo, report_date: r.reportDate, shift: r.shift, time_slot: r.timeSlot, lot_no: r.lotNo, product_id: productIds.get(r.productRaw) || null, product_raw: r.productRaw, weight_mt: r.weightMt, jute_bag: r.juteBag, plastic_bag: r.plasticBag, ss: r.ss, fiber: r.fiber, moi: r.moi, moi_rec: r.moiRec, lab_oil: r.labOil, lab_oil_rec_pct: r.labOilRecPct, reported_oil: r.reportedOil, r_oil_rec_pct: r.rOilRecPct, amount: r.amount, feeding_pct: r.feedingPct, row_fingerprint: r.rowFingerprint });
    } else if (existingFp === r.rowFingerprint) duplicateRows++;
    else { corrections.push({ key, reportDate: r.reportDate }); correctionFlags++; }
  }
  if (toInsert.length) {
    // Upsert-with-ignoreDuplicates on the real unique(reference_no, lot_no)
    // constraint instead of a plain insert: the pre-check above (SELECT then
    // decide new/duplicate/correction) has the same race window as every
    // other persist function here — two concurrent uploads of the same file
    // could both see a key as "new" before either commits. ignoreDuplicates
    // means the loser of that race is silently skipped at the DB level
    // instead of crashing the batch; newRows is corrected to the count
    // Postgres actually inserted.
    const { data, error } = await db.from('ops_feeding_entries').upsert(toInsert, { onConflict: 'reference_no,lot_no', ignoreDuplicates: true }).select('reference_no');
    if (error) throw new Error(`Feeding Details insert failed: ${error.message}`);
    newRows = data?.length || 0;
  }
  if (corrections.length) await writeExceptions(corrections.map(c => ({ exceptionType: 'row_correction_detected', severity: 'warning' as const, reportDate: c.reportDate, module: 'ops_raw_material', referenceIds: { key: c.key }, description: `Feeding row ${c.key} was re-uploaded with different values than the version already stored. The original is kept; review before treating either as authoritative.` })));
  return { newRows, duplicateRows, correctionFlags };
}

async function persistProduction(batchId: string, rows: import('./parsers/production').ParsedProductionRow[]) {
  const db = supabaseAdmin();
  const productIds = await resolveProductIds('production', rows.map(r => r.productRaw));
  const refs = [...new Set(rows.map(r => r.referenceNo))];
  // Business key is (reference_no, time_slot, product_raw, packing) — a
  // reference_no is per-SHIFT and repeats across every hourly time_slot
  // (see sql/044_ops_production_composite_key_fix.sql for the live test
  // that caught this).
  const { data: existingRows } = await db.from('ops_production_entries').select('reference_no,time_slot,product_raw,packing,row_fingerprint').in('reference_no', refs);
  const existingByKey = new Map((existingRows || []).map((r: any) => [`${r.reference_no}|${r.time_slot}|${r.product_raw}|${r.packing}`, r.row_fingerprint]));
  let newRows = 0, duplicateRows = 0, correctionFlags = 0;
  const toInsert: any[] = []; const seenThisBatch = new Set<string>(); const corrections: { key: string; reportDate: string }[] = [];
  for (const r of rows) {
    const key = `${r.referenceNo}|${r.timeSlot}|${r.productRaw}|${r.packing}`;
    if (seenThisBatch.has(key)) continue;
    seenThisBatch.add(key);
    const existingFp = existingByKey.get(key);
    if (existingFp === undefined) {
      toInsert.push({ upload_batch_id: batchId, reference_no: r.referenceNo, report_date: r.reportDate, shift: r.shift, time_slot: r.timeSlot, product_id: productIds.get(r.productRaw) || null, product_raw: r.productRaw, packing: r.packing, quantity: r.quantity, oil: r.oil, moi: r.moi, ss_pct: r.ssPct, fiber: r.fiber, protein: r.protein, ffa: r.ffa, iv: r.iv, tash: r.tash, pdi: r.pdi, urea: r.urea, production_pct: r.productionPct, description: r.description, row_fingerprint: r.rowFingerprint });
    } else if (existingFp === r.rowFingerprint) duplicateRows++;
    else { corrections.push({ key, reportDate: r.reportDate }); correctionFlags++; }
  }
  if (toInsert.length) {
    // Same fix as persistFeeding: upsert on the real unique(reference_no,
    // time_slot, product_raw, packing) constraint instead of a plain insert.
    const { data, error } = await db.from('ops_production_entries').upsert(toInsert, { onConflict: 'reference_no,time_slot,product_raw,packing', ignoreDuplicates: true }).select('reference_no');
    if (error) throw new Error(`Production Report insert failed: ${error.message}`);
    newRows = data?.length || 0;
  }
  if (corrections.length) await writeExceptions(corrections.map(c => ({ exceptionType: 'row_correction_detected', severity: 'warning' as const, reportDate: c.reportDate, module: 'ops_production', referenceIds: { key: c.key }, description: `Production row ${c.key} was re-uploaded with different values than the version already stored. The original is kept; review before treating either as authoritative.` })));
  return { newRows, duplicateRows, correctionFlags };
}

/** Snapshot types are versioned at the BATCH level, not per row: the whole
 * batch replaces the previously-active batch for that (report_type,
 * report_date), while every prior version's rows stay in the table
 * (excluded from "current" queries via is_active) for audit. */
async function activateSnapshotBatch(reportType: ReportType, batchId: string, reportDate: string): Promise<{ versionNo: number; supersededBatchId: string | null }> {
  const db = supabaseAdmin();
  const { data: prior } = await db.from('ops_upload_batches').select('id,version_no').eq('report_type', reportType).eq('report_date', reportDate).eq('is_active', true).neq('id', batchId).maybeSingle();
  if (prior) {
    await db.from('ops_upload_batches').update({ is_active: false }).eq('id', (prior as any).id);
    const versionNo = (prior as any).version_no + 1;
    await db.from('ops_upload_batches').update({ version_no: versionNo, supersedes_batch_id: (prior as any).id }).eq('id', batchId);
    return { versionNo, supersededBatchId: (prior as any).id };
  }
  return { versionNo: 1, supersededBatchId: null };
}

async function persistStockSnapshot(batchId: string, rows: import('./parsers/stockSummary').ParsedStockSnapshotRow[]) {
  const db = supabaseAdmin();
  const productIds = await resolveProductIds('stock_snapshot', rows.map(r => r.particulars));
  const toInsert = rows.map(r => ({ upload_batch_id: batchId, category: r.category, particulars: r.particulars, product_id: productIds.get(r.particulars) || null, packing_size: r.packingSize, packing_name: r.packingName, opening_qty: r.openingQty, inward_qty: r.inwardQty, outward_qty: r.outwardQty, closing_qty: r.closingQty, closing_value: r.closingValue }));
  const { error } = await db.from('ops_stock_snapshots').insert(toInsert);
  if (error) throw new Error(`Stock Summary insert failed: ${error.message}`);
  return { newRows: toInsert.length, duplicateRows: 0, correctionFlags: 0 };
}

async function persistRmBatchStock(batchId: string, rows: import('./parsers/rmBatchStock').ParsedRmBatchRow[]) {
  const db = supabaseAdmin();
  const toInsert = rows.map(r => ({ upload_batch_id: batchId, lot_no: r.lotNo, report_date: r.reportDate || null, grade: r.grade, supplier_name: r.supplierName, weight_mt: r.weightMt, area: r.area, jute_bag: r.juteBag, plastic_bag: r.plasticBag, total_bags: r.totalBags, rate: r.rate, value: r.value }));
  const { error } = await db.from('ops_rm_batch_stock').insert(toInsert);
  if (error) throw new Error(`Raw Material Batch Wise Stock insert failed: ${error.message}`);
  return { newRows: toInsert.length, duplicateRows: 0, correctionFlags: 0 };
}

async function persistPurchaseOrderPending(batchId: string, rows: import('./parsers/purchaseOrderPending').ParsedPoPendingRow[]) {
  const db = supabaseAdmin();
  const productIds = await resolveProductIds('purchase_order_pending', rows.map(r => r.productRaw));
  const toInsert = rows.map(r => ({ upload_batch_id: batchId, source_report: 'purchase_order_pending', po_no: r.poNo, po_date: r.poDate || null, product_id: productIds.get(r.productRaw) || null, product_raw: r.productRaw, supplier_name: r.supplierName, broker_name: r.brokerName, ordered_qty: r.orderedQty, received_qty: r.receivedQty, pending_qty: r.pendingQty, rate: r.rate }));
  const { error } = await db.from('ops_purchase_orders').insert(toInsert);
  if (error) throw new Error(`PurchaseOrder Pending insert failed: ${error.message}`);
  return { newRows: toInsert.length, duplicateRows: 0, correctionFlags: 0 };
}

async function persistPurchaseDetails(batchId: string, rows: import('./parsers/purchaseDetails').ParsedPurchaseDetailRow[]) {
  const db = supabaseAdmin();
  const productIds = await resolveProductIds('purchase_details', rows.map(r => r.productRaw));
  const pos = [...new Set(rows.map(r => r.poNo))];
  const { data: existingRows } = await db.from('ops_purchase_orders').select('po_no,product_raw,received_qty,pending_qty,status').eq('source_report', 'purchase_details').in('po_no', pos);
  const existingByKey = new Map((existingRows || []).map((r: any) => [`${r.po_no}|${r.product_raw}`, `${r.received_qty}|${r.pending_qty}|${r.status}`]));
  let newRows = 0, duplicateRows = 0, correctionFlags = 0;
  const toInsert: any[] = []; const seenThisBatch = new Set<string>(); const corrections: { key: string; reportDate: string }[] = [];
  for (const r of rows) {
    const key = `${r.poNo}|${r.productRaw}`;
    if (seenThisBatch.has(key)) continue;
    seenThisBatch.add(key);
    const fingerprint = `${r.receivedQty}|${r.pendingQty}|${r.status}`;
    const existingFp = existingByKey.get(key);
    if (existingFp === undefined) {
      toInsert.push({ upload_batch_id: batchId, source_report: 'purchase_details', po_no: r.poNo, po_date: r.poDate || null, product_id: productIds.get(r.productRaw) || null, product_raw: r.productRaw, supplier_name: r.supplierName, ordered_qty: r.orderedQty, rate: r.rate, received_qty: r.receivedQty, pending_qty: r.pendingQty, status: r.status });
      newRows++;
    } else if (existingFp === fingerprint) duplicateRows++;
    else { corrections.push({ key, reportDate: r.poDate }); correctionFlags++; }
  }
  if (toInsert.length) { const { error } = await db.from('ops_purchase_orders').insert(toInsert); if (error) throw new Error(`Purchase Details insert failed: ${error.message}`); }
  if (corrections.length) await writeExceptions(corrections.map(c => ({ exceptionType: 'row_correction_detected', severity: 'info' as const, reportDate: c.reportDate, module: 'ops_supply', referenceIds: { key: c.key }, description: `Purchase order ${c.key} shows different received/pending/status values than the last upload — likely genuine PO progress, kept as a new row rather than overwriting.` })));
  return { newRows, duplicateRows, correctionFlags };
}

async function persistGateMovements(batchId: string, direction: 'IN' | 'OUT', rows: (import('./parsers/gateIn').ParsedGateInRow | import('./parsers/gateOut').ParsedGateOutRow)[]) {
  const db = supabaseAdmin();
  const toInsert: any[] = []; const seenThisBatch = new Set<string>();
  for (const r of rows as any[]) {
    if (seenThisBatch.has(r.gatePassNo)) continue;
    seenThisBatch.add(r.gatePassNo);
    toInsert.push({ upload_batch_id: batchId, gate_pass_no: r.gatePassNo, direction, movement_date: r.movementDate || null, po_no: r.poNo || null, so_no: r.soNo || null, party_name: r.supplierName || r.customerName || null, party_address: r.supplierAddress || r.customerAddress || null, material_raw: r.materialRaw || r.productRaw || null, vehicle_no: r.vehicleNo, in_time: r.inTime, out_time: r.outTime, remarks: r.remarks });
  }
  let newRows = 0, duplicateRows = 0;
  if (toInsert.length) {
    // Upsert-with-ignoreDuplicates instead of a separate SELECT-then-insert:
    // the old check-then-insert had a real race window (two concurrent
    // uploads of the same file could both pass the pre-check before either
    // committed, and the second insert then crashed the whole batch on
    // ops_gate_movements' unique(gate_pass_no) constraint — confirmed live).
    // RETURNING only the rows Postgres actually inserted gives the true
    // new-vs-duplicate split even under that race, instead of trusting a
    // pre-check that can go stale between reading it and writing.
    const { data, error } = await db.from('ops_gate_movements').upsert(toInsert, { onConflict: 'gate_pass_no', ignoreDuplicates: true }).select('gate_pass_no');
    if (error) throw new Error(`Gate ${direction === 'IN' ? 'In' : 'Out'} Entry insert failed: ${error.message}`);
    newRows = data?.length || 0;
    duplicateRows = toInsert.length - newRows;
  }
  return { newRows, duplicateRows, correctionFlags: 0 };
}

async function persistWeighments(batchId: string, direction: 'IN' | 'OUT', rows: (import('./parsers/timeOfficeIn').ParsedTimeOfficeInRow | import('./parsers/timeOfficeOut').ParsedTimeOfficeOutRow)[], productReportType: string) {
  const db = supabaseAdmin();
  const productTexts = (rows as any[]).map(r => r.productRaw).filter(Boolean);
  const productIds = await resolveProductIds(productReportType, productTexts);
  const toInsert: any[] = []; const seenThisBatch = new Set<string>();
  for (const r of rows as any[]) {
    if (seenThisBatch.has(r.gatePassNo)) continue;
    seenThisBatch.add(r.gatePassNo);
    toInsert.push({ upload_batch_id: batchId, gate_pass_no: r.gatePassNo, direction, weighment_date: r.weighmentDate || null, po_no: r.poNo || null, so_no: r.soNo || null, lot_no: r.lotNo || null, product_id: r.productRaw ? productIds.get(r.productRaw) || null : null, product_raw: r.productRaw || null, party_name: r.supplierName || r.customerName || null, vehicle_no: r.vehicleNo, gunny_bags: r.gunnyBags, plastic_bags: r.plasticBags, total_bags: r.totalBags, gross_weight: r.grossWeight, tare_weight: r.tareWeight, net_weight: r.netWeight, remarks: r.remarks });
  }
  let newRows = 0, duplicateRows = 0, insertedRows: any[] = [];
  if (toInsert.length) {
    // Same fix as persistGateMovements: upsert-with-ignoreDuplicates on the
    // real unique(gate_pass_no) constraint instead of a racy SELECT-then-
    // insert, so two concurrent uploads of the same file can never crash
    // this the way Gate In did.
    const { data, error } = await db.from('ops_weighments').upsert(toInsert, { onConflict: 'gate_pass_no', ignoreDuplicates: true }).select('gate_pass_no,lot_no,po_no,party_name,product_id,net_weight');
    if (error) throw new Error(`Time Office ${direction === 'IN' ? 'In' : 'Out'} Report insert failed: ${error.message}`);
    insertedRows = data || [];
    newRows = insertedRows.length;
    duplicateRows = toInsert.length - newRows;
  }
  if (direction === 'IN') {
    for (const r of insertedRows) if (r.lot_no) await advanceLot(r.lot_no, 'WEIGHED', `Inward weighment recorded at gate pass ${r.gate_pass_no} — net weight ${r.net_weight ?? '—'} MT.`, { poNo: r.po_no, gatePassNo: r.gate_pass_no, supplierName: r.party_name, productId: r.product_id }).catch(() => {});
    const dateByLot = new Map(toInsert.filter(r => r.lot_no).map(r => [r.lot_no, r.weighment_date]));
    const lotsWithDate = [...dateByLot.keys()];
    if (lotsWithDate.length) await reportLotChainGaps(lotsWithDate, dateByLot, toInsert[0]?.weighment_date || new Date().toISOString().slice(0, 10));
  }
  return { newRows, duplicateRows, correctionFlags: 0 };
}

async function persistInwardQc(batchId: string, rows: import('./parsers/inwardQc').ParsedQcSampleRow[]) {
  const db = supabaseAdmin();
  const productIds = await resolveProductIds('inward_qc', rows.map(r => r.productRaw));
  const toInsert: any[] = []; const seenThisBatch = new Set<string>();
  for (const r of rows) {
    const key = `${r.lotNo}|${r.sampleCode}`;
    if (seenThisBatch.has(key)) continue;
    seenThisBatch.add(key);
    toInsert.push({ upload_batch_id: batchId, reference_no: r.referenceNo, lot_no: r.lotNo, report_date: r.reportDate || null, product_id: productIds.get(r.productRaw) || null, product_raw: r.productRaw, sample_code: r.sampleCode, calcium: r.calcium, ffa: r.ffa, fiber: r.fiber, iv: r.iv, moi: r.moi, oil: r.oil, protein: r.protein, ss: r.ss });
  }
  let newRows = 0, duplicateRows = 0, insertedRows: any[] = [];
  if (toInsert.length) {
    // Same fix as persistGateMovements: upsert on the real
    // unique(lot_no, sample_code) constraint instead of a racy
    // SELECT-then-insert.
    const { data, error } = await db.from('ops_qc_results').upsert(toInsert, { onConflict: 'lot_no,sample_code', ignoreDuplicates: true }).select('lot_no');
    if (error) throw new Error(`Inward QC Report insert failed: ${error.message}`);
    insertedRows = data || [];
    newRows = insertedRows.length;
    duplicateRows = toInsert.length - newRows;
  }
  for (const lotNo of new Set(insertedRows.map((r: any) => r.lot_no))) await advanceLot(lotNo, 'QC_COMPLETED', `Inward QC recorded for lot ${lotNo}.`).catch(() => {});
  const qcDateByLot = new Map(toInsert.filter(r => r.lot_no).map(r => [r.lot_no, r.report_date]));
  const qcLots = [...new Set(insertedRows.map((r: any) => r.lot_no).filter(Boolean))];
  if (qcLots.length) await reportLotChainGaps(qcLots, qcDateByLot, toInsert[0]?.report_date || new Date().toISOString().slice(0, 10));
  return { newRows, duplicateRows, correctionFlags: 0 };
}

async function persistSettlementPending(batchId: string, rows: import('./parsers/settlementPending').ParsedSettlementRow[]) {
  const db = supabaseAdmin();
  const productIds = await resolveProductIds('settlement_pending', rows.map(r => r.productRaw));
  const toInsert = rows.map(r => ({ upload_batch_id: batchId, reference_no: r.referenceNo, purchase_type: r.purchaseType, inward_date: r.inwardDate || null, lot_no: r.lotNo, product_id: productIds.get(r.productRaw) || null, product_raw: r.productRaw, supplier_name: r.supplierName, quantity: r.quantity, ffa: r.ffa, fiber: r.fiber, iv: r.iv, moi: r.moi, oil: r.oil, ss: r.ss }));
  const { error } = await db.from('ops_settlements').insert(toInsert);
  if (error) throw new Error(`SettlementPending Lot insert failed: ${error.message}`);
  for (const r of toInsert) if (r.lot_no) await advanceLot(r.lot_no, 'SETTLEMENT_PENDING', `Settlement pending for lot ${r.lot_no} (reference ${r.reference_no}).`, { supplierName: r.supplier_name, productId: r.product_id }).catch(() => {});
  const settleDateByLot = new Map(toInsert.filter(r => r.lot_no).map(r => [r.lot_no, r.inward_date]));
  const settleLots = [...settleDateByLot.keys()];
  if (settleLots.length) await reportLotChainGaps(settleLots, settleDateByLot, toInsert[0]?.inward_date || new Date().toISOString().slice(0, 10));
  return { newRows: toInsert.length, duplicateRows: 0, correctionFlags: 0 };
}

async function persistSaleOrderDetails(batchId: string, rows: import('./parsers/saleOrderDetails').ParsedSaleOrderRow[]) {
  const db = supabaseAdmin();
  const productIds = await resolveProductIds('sale_order_details', rows.map(r => r.productRaw));
  const sos = [...new Set(rows.map(r => r.soNo))];
  const { data: existingRows } = await db.from('ops_sales_orders').select('so_no,product_raw,dispatched_qty,status').in('so_no', sos);
  const existingByKey = new Map((existingRows || []).map((r: any) => [`${r.so_no}|${r.product_raw}`, `${r.dispatched_qty}|${r.status}`]));
  let newRows = 0, duplicateRows = 0, correctionFlags = 0;
  const toInsert: any[] = []; const seenThisBatch = new Set<string>(); const corrections: { key: string; reportDate: string }[] = [];
  for (const r of rows) {
    const key = `${r.soNo}|${r.productRaw}`;
    if (seenThisBatch.has(key)) continue;
    seenThisBatch.add(key);
    const fingerprint = `${r.despatchedQty}|${r.status}`;
    const existingFp = existingByKey.get(key);
    if (existingFp === undefined) {
      toInsert.push({ upload_batch_id: batchId, so_no: r.soNo, so_date: r.soDate || null, customer_po_no: r.customerPoNo, customer_name: r.customerName, customer_location: r.customerLocation, consignee_name: r.consigneeName, dispatch_location: r.dispatchLocation, product_id: productIds.get(r.productRaw) || null, product_raw: r.productRaw, packing_size: r.packingSize, quantity: r.quantity, uom: r.uom, rate: r.rate, dispatched_qty: r.despatchedQty, status: r.status, gross_amount: r.grossAmount, total_amount: r.totalAmount });
    } else if (existingFp === fingerprint) duplicateRows++;
    else { corrections.push({ key, reportDate: r.soDate }); correctionFlags++; }
  }
  if (toInsert.length) {
    // Same fix as persistFeeding: upsert on the real unique(so_no,
    // product_raw) constraint instead of a plain insert.
    const { data, error } = await db.from('ops_sales_orders').upsert(toInsert, { onConflict: 'so_no,product_raw', ignoreDuplicates: true }).select('so_no');
    if (error) throw new Error(`Sale Order Details insert failed: ${error.message}`);
    newRows = data?.length || 0;
  }
  if (corrections.length) await writeExceptions(corrections.map(c => ({ exceptionType: 'row_correction_detected', severity: 'info' as const, reportDate: c.reportDate, module: 'ops_sales', referenceIds: { key: c.key }, description: `Sale order ${c.key} shows different dispatched qty/status than the last upload — likely genuine SO progress, kept as a new row rather than overwriting.` })));
  return { newRows, duplicateRows, correctionFlags };
}

async function persistSalesRegister(batchId: string, rows: import('./parsers/salesRegister').ParsedSalesRegisterRow[]) {
  const db = supabaseAdmin();
  const productIds = await resolveProductIds('sales_register', rows.map(r => r.productRaw));
  const toInsert: any[] = []; const seenThisBatch = new Set<string>();
  for (const r of rows) {
    const key = `${r.invoiceNo}|${r.productRaw}|${r.packingSize}`;
    if (seenThisBatch.has(key)) continue;
    seenThisBatch.add(key);
    toInsert.push({ upload_batch_id: batchId, invoice_no: r.invoiceNo, so_no: r.soNo, invoice_date: r.invoiceDate || null, party_name: r.partyName, place: r.place, vehicle_no: r.vehicleNo, product_id: productIds.get(r.productRaw) || null, product_raw: r.productRaw, packing_size: r.packingSize, rate: r.rate, quantity_mt: r.quantityMt, quantity_kg: r.quantityKg, plastic_bag: r.plasticBag, jute_bag: r.juteBag, total_bags: r.totalBags, amount: r.amount, tax_amount: r.taxAmount, total_invoice_amount: r.totalInvoiceAmount });
  }
  let newRows = 0, duplicateRows = 0;
  if (toInsert.length) {
    // Same fix as persistGateMovements: upsert on the real
    // unique(invoice_no, product_raw, packing_size) constraint instead of a
    // racy SELECT-then-insert.
    const { data, error } = await db.from('ops_sales_invoices').upsert(toInsert, { onConflict: 'invoice_no,product_raw,packing_size', ignoreDuplicates: true }).select('invoice_no');
    if (error) throw new Error(`Sales Register insert failed: ${error.message}`);
    newRows = data?.length || 0;
    duplicateRows = toInsert.length - newRows;
  }
  return { newRows, duplicateRows, correctionFlags: 0 };
}

async function persistPurchaseReceipts(batchId: string, rows: import('./parsers/purchaseReceipts').ParsedPurchaseReceiptRow[]) {
  const db = supabaseAdmin();
  const productIds = await resolveProductIds('purchase_receipts', rows.map(r => r.productRaw));
  const toInsert: any[] = []; const seenThisBatch = new Set<string>();
  for (const r of rows) {
    if (seenThisBatch.has(r.rnNo)) continue;
    seenThisBatch.add(r.rnNo);
    toInsert.push({ upload_batch_id: batchId, purchase_type: r.purchaseType, rn_no: r.rnNo, rn_date: r.rnDate || null, po_no: r.poNo || null, lot_no: r.lotNo || null, supplier_name: r.supplierName, place: r.place, vehicle_no: r.vehicleNo, product_id: productIds.get(r.productRaw) || null, product_raw: r.productRaw, bill_no: r.billNo, bill_rate: r.billRate, bill_qty: r.billQty, cgst: r.cgst, sgst: r.sgst, igst: r.igst, bill_value: r.billValue, weight: r.weight, jute_bag: r.juteBag, plastic_bag: r.plasticBag, total_bags: r.totalBags, freight_amt: r.freightAmt });
  }
  let newRows = 0, duplicateRows = 0, insertedRows: any[] = [];
  if (toInsert.length) {
    // Same fix as persistGateMovements: upsert on the real unique(rn_no)
    // constraint instead of a racy SELECT-then-insert.
    const { data, error } = await db.from('ops_purchase_receipts').upsert(toInsert, { onConflict: 'rn_no', ignoreDuplicates: true }).select('rn_no,lot_no,po_no,supplier_name,product_id,bill_no');
    if (error) throw new Error(`Purchase Register LotWise insert failed: ${error.message}`);
    insertedRows = data || [];
    newRows = insertedRows.length;
    duplicateRows = toInsert.length - newRows;
  }
  for (const r of insertedRows) if (r.lot_no) await advanceLot(r.lot_no, 'RECEIPT_CREATED', `Purchase receipt ${r.rn_no} created for lot ${r.lot_no} (bill ${r.bill_no || '—'}).`, { poNo: r.po_no, supplierName: r.supplier_name, productId: r.product_id }).catch(() => {});
  const receiptDateByLot = new Map(toInsert.filter(r => r.lot_no).map(r => [r.lot_no, r.rn_date]));
  const receiptLots = [...new Set(insertedRows.map((r: any) => r.lot_no).filter(Boolean))];
  if (receiptLots.length) await reportLotChainGaps(receiptLots, receiptDateByLot, toInsert[0]?.rn_date || new Date().toISOString().slice(0, 10));
  return { newRows, duplicateRows, correctionFlags: 0 };
}

async function persistBrokerage(batchId: string, rows: import('./parsers/brokerage').ParsedBrokerageRow[]) {
  const db = supabaseAdmin();
  const toInsert: any[] = []; const seenThisBatch = new Set<string>();
  for (const r of rows) {
    if (seenThisBatch.has(r.conNo)) continue;
    seenThisBatch.add(r.conNo);
    toInsert.push({ upload_batch_id: batchId, con_no: r.conNo, con_date: r.conDate || null, broker_name: r.brokerName, party_name: r.partyName, grade: r.grade, calc_type: r.calcType, con_qty: r.conQty, des_rec_qty: r.desRecQty, per_ton: r.perTon, jute_bag: r.juteBag, plastic_bag: r.plasticBag, total: r.total });
  }
  let newRows = 0, duplicateRows = 0;
  if (toInsert.length) {
    const { data, error } = await db.from('ops_brokerage').upsert(toInsert, { onConflict: 'con_no', ignoreDuplicates: true }).select('con_no');
    if (error) throw new Error(`Brokerage insert failed: ${error.message}`);
    newRows = data?.length || 0;
    duplicateRows = toInsert.length - newRows;
  }
  return { newRows, duplicateRows, correctionFlags: 0 };
}

async function persistConsumableIssue(batchId: string, rows: import('./parsers/consumableIssue').ParsedConsumableIssueRow[]) {
  const db = supabaseAdmin();
  const toInsert: any[] = []; const seenThisBatch = new Set<string>();
  for (const r of rows) {
    const key = `${r.referenceNo}|${r.productRaw}`;
    if (seenThisBatch.has(key)) continue;
    seenThisBatch.add(key);
    toInsert.push({ upload_batch_id: batchId, issue_date: r.issueDate || null, reference_no: r.referenceNo, department: r.department, product_raw: r.productRaw, weight: r.weight });
  }
  let newRows = 0, duplicateRows = 0;
  if (toInsert.length) {
    const { data, error } = await db.from('ops_consumable_issues').upsert(toInsert, { onConflict: 'reference_no,product_raw', ignoreDuplicates: true }).select('reference_no');
    if (error) throw new Error(`Consumable Issue insert failed: ${error.message}`);
    newRows = data?.length || 0;
    duplicateRows = toInsert.length - newRows;
  }
  return { newRows, duplicateRows, correctionFlags: 0 };
}

async function persistEbPowerReadings(batchId: string, rows: import('./parsers/ebPowerReading').ParsedEbPowerReadingRow[]) {
  const db = supabaseAdmin();
  const toInsert: any[] = []; const seenThisBatch = new Set<string>();
  for (const r of rows) {
    const key = `${r.reportDate}|${r.department}|${r.particulars}`;
    if (seenThisBatch.has(key)) continue;
    seenThisBatch.add(key);
    toInsert.push({ upload_batch_id: batchId, report_date: r.reportDate || null, department: r.department, particulars: r.particulars, opening_kwh: r.openingKwh, closing_kwh: r.closingKwh, consumption_units: r.consumptionUnits, remarks: r.remarks });
  }
  let newRows = 0, duplicateRows = 0;
  if (toInsert.length) {
    const { data, error } = await db.from('ops_eb_power_readings').upsert(toInsert, { onConflict: 'report_date,department,particulars', ignoreDuplicates: true }).select('report_date');
    if (error) throw new Error(`EB Power Reading insert failed: ${error.message}`);
    newRows = data?.length || 0;
    duplicateRows = toInsert.length - newRows;
  }
  return { newRows, duplicateRows, correctionFlags: 0 };
}

async function persistFreightSummary(batchId: string, rows: import('./parsers/freightSummary').ParsedFreightSummaryRow[]) {
  const db = supabaseAdmin();
  const toInsert: any[] = []; const seenThisBatch = new Set<string>();
  for (const r of rows) {
    if (seenThisBatch.has(r.invoiceNo)) continue;
    seenThisBatch.add(r.invoiceNo);
    toInsert.push({ upload_batch_id: batchId, invoice_no: r.invoiceNo, invoice_date: r.invoiceDate || null, party_name: r.partyName, invoice_location: r.invoiceLocation, vehicle_no: r.vehicleNo, product_raw: r.productRaw, invoice_qty: r.invoiceQty, freight_amt_per_ton: r.freightAmtPerTon });
  }
  let newRows = 0, duplicateRows = 0;
  if (toInsert.length) {
    const { data, error } = await db.from('ops_freight_summary').upsert(toInsert, { onConflict: 'invoice_no', ignoreDuplicates: true }).select('invoice_no');
    if (error) throw new Error(`Freight Summary insert failed: ${error.message}`);
    newRows = data?.length || 0;
    duplicateRows = toInsert.length - newRows;
  }
  return { newRows, duplicateRows, correctionFlags: 0 };
}

async function persistQcPendingLots(batchId: string, rows: import('./parsers/qcPendingLots').ParsedQcPendingLotRow[]) {
  const db = supabaseAdmin();
  const productIds = await resolveProductIds('qc_pending_lots', rows.map(r => r.productRaw));
  const toInsert: any[] = []; const seenThisBatch = new Set<string>();
  for (const r of rows) {
    if (seenThisBatch.has(r.lotNo)) continue;
    seenThisBatch.add(r.lotNo);
    toInsert.push({ upload_batch_id: batchId, reference_no: r.referenceNo, pending_date: r.pendingDate || null, party_name: r.partyName, product_id: productIds.get(r.productRaw) || null, product_raw: r.productRaw, lot_no: r.lotNo, codes: r.codes, quantity: r.quantity });
  }
  let newRows = 0, duplicateRows = 0;
  if (toInsert.length) {
    const { data, error } = await db.from('ops_qc_pending_lots').upsert(toInsert, { onConflict: 'lot_no', ignoreDuplicates: true }).select('lot_no');
    if (error) throw new Error(`QC Pending Lots insert failed: ${error.message}`);
    newRows = data?.length || 0;
    duplicateRows = toInsert.length - newRows;
  }
  return { newRows, duplicateRows, correctionFlags: 0 };
}

async function persistShutDown(batchId: string, rows: import('./parsers/shutDown').ParsedShutDownRow[]) {
  const db = supabaseAdmin();
  const toInsert: any[] = []; const seenThisBatch = new Set<string>();
  for (const r of rows) {
    const key = `${r.effectiveDate}|${r.fromTime}|${r.toTime}`;
    if (seenThisBatch.has(key)) continue;
    seenThisBatch.add(key);
    toInsert.push({ upload_batch_id: batchId, effective_date: r.effectiveDate || null, reason: r.reason, from_time: r.fromTime, to_time: r.toTime, minutes: r.minutes, cumulative: r.cumulative, remarks: r.remarks });
  }
  let newRows = 0, duplicateRows = 0;
  if (toInsert.length) {
    const { data, error } = await db.from('ops_shutdowns').upsert(toInsert, { onConflict: 'effective_date,from_time,to_time', ignoreDuplicates: true }).select('effective_date');
    if (error) throw new Error(`Shut Down insert failed: ${error.message}`);
    newRows = data?.length || 0;
    duplicateRows = toInsert.length - newRows;
  }
  return { newRows, duplicateRows, correctionFlags: 0 };
}

async function persistSolventDailyReadings(batchId: string, rows: import('./parsers/solventDailyReport').ParsedSolventDailyRow[]) {
  const db = supabaseAdmin();
  const toInsert: any[] = []; const seenThisBatch = new Set<string>();
  for (const r of rows) {
    const key = `${r.reportDate}|${r.shift}|${r.timeSlot}|${r.rowSeq}`;
    if (seenThisBatch.has(key)) continue;
    seenThisBatch.add(key);
    toInsert.push({ upload_batch_id: batchId, report_date: r.reportDate || null, shift: r.shift, time_slot: r.timeSlot, row_seq: r.rowSeq, spray1_ffa: r.spray1Ffa, spray2_ffa: r.spray2Ffa, dob_doc_oil_pct: r.dobDocOilPct, miscella: r.miscella, production_oil_ffa: r.productionOilFfa, iv: r.iv, mv: r.mv, flash_point: r.flashPoint, remarks: r.remarks, extra: r.extra });
  }
  let newRows = 0, duplicateRows = 0;
  if (toInsert.length) {
    const { data, error } = await db.from('ops_solvent_daily_readings').upsert(toInsert, { onConflict: 'report_date,shift,time_slot,row_seq', ignoreDuplicates: true }).select('report_date');
    if (error) throw new Error(`Solvent Daily Report insert failed: ${error.message}`);
    newRows = data?.length || 0;
    duplicateRows = toInsert.length - newRows;
  }
  return { newRows, duplicateRows, correctionFlags: 0 };
}

async function persistContractPending(batchId: string, rows: import('./parsers/contractPending').ParsedContractPendingRow[]) {
  const db = supabaseAdmin();
  const productIds = await resolveProductIds('contract_pending', rows.map(r => r.productRaw));
  const toInsert = rows.map(r => ({ upload_batch_id: batchId, product_id: productIds.get(r.productRaw) || null, product_raw: r.productRaw, cont_no: r.contNo, cont_date: r.contDate || null, party_name: r.partyName, place: r.place, rate_per_ton: r.ratePerTon, con_qty: r.conQty, des_qty: r.desQty, bal_qty: r.balQty }));
  const { error } = await db.from('ops_contract_pending').insert(toInsert);
  if (error) throw new Error(`Contract List Pending insert failed: ${error.message}`);
  return { newRows: toInsert.length, duplicateRows: 0, correctionFlags: 0 };
}

async function persistInwardPayments(batchId: string, rows: import('./parsers/inwardPayment').ParsedInwardPaymentRow[]) {
  const db = supabaseAdmin();
  const toInsert: any[] = []; const seenThisBatch = new Set<string>();
  for (const r of rows) {
    const key = `${r.referenceNo}|${r.lotOrBillNo}`;
    if (seenThisBatch.has(key)) continue;
    seenThisBatch.add(key);
    toInsert.push({ upload_batch_id: batchId, reference_no: r.referenceNo, payment_date: r.paymentDate || null, supplier_name: r.supplierName, location: r.location, bank_name: r.bankName, lot_or_bill_no: r.lotOrBillNo, amount: r.amount, total_amount: r.totalAmount });
  }
  let newRows = 0, duplicateRows = 0;
  if (toInsert.length) {
    const { data, error } = await db.from('ops_inward_payments').upsert(toInsert, { onConflict: 'reference_no,lot_or_bill_no', ignoreDuplicates: true }).select('reference_no');
    if (error) throw new Error(`Inward Payment insert failed: ${error.message}`);
    newRows = data?.length || 0;
    duplicateRows = toInsert.length - newRows;
  }
  return { newRows, duplicateRows, correctionFlags: 0 };
}

async function persistPurchaseSummary(batchId: string, rows: import('./parsers/purchaseSummary').ParsedPurchaseSummaryRow[]) {
  const db = supabaseAdmin();
  const productIds = await resolveProductIds('purchase_summary', rows.map(r => r.productRaw));
  const toInsert: any[] = []; const seenThisBatch = new Set<string>();
  for (const r of rows) {
    if (seenThisBatch.has(r.referenceNo)) continue;
    seenThisBatch.add(r.referenceNo);
    toInsert.push({ upload_batch_id: batchId, purchase_type: r.purchaseType, po_no: r.poNo || null, reference_no: r.referenceNo, inward_date: r.inwardDate || null, supplier_name: r.supplierName, supplier_location: r.supplierLocation, product_id: productIds.get(r.productRaw) || null, product_raw: r.productRaw, lot_no: r.lotNo || null, supplier_invoice_no: r.supplierInvoiceNo, supplier_invoice_date: r.supplierInvoiceDate || null, value: r.value, igst_amount: r.igstAmount, sgst_amount: r.sgstAmount, cgst_amount: r.cgstAmount, gross_amount: r.grossAmount, voucher_type: r.voucherType, credit_debit_no: r.creditDebitNo, credit_date: r.creditDate || null, quality_rebate: r.qualityRebate, rebate_igst: r.rebateIgst, rebate_sgst: r.rebateSgst, rebate_cgst: r.rebateCgst, unloading: r.unloading, weighment: r.weighment, lorry_freight: r.lorryFreight, advance: r.advance, brokerage: r.brokerage, other_expenses: r.otherExpenses, tds: r.tds, final_value: r.finalValue, payment_igst: r.paymentIgst, payment_sgst: r.paymentSgst, payment_cgst: r.paymentCgst, payable_amount: r.payableAmount, paid_amount: r.paidAmount });
  }
  let newRows = 0, duplicateRows = 0;
  if (toInsert.length) {
    const { data, error } = await db.from('ops_purchase_summary').upsert(toInsert, { onConflict: 'reference_no', ignoreDuplicates: true }).select('reference_no');
    if (error) throw new Error(`Purchase Summary insert failed: ${error.message}`);
    newRows = data?.length || 0;
    duplicateRows = toInsert.length - newRows;
  }
  return { newRows, duplicateRows, correctionFlags: 0 };
}

async function persistCreditDebitNotes(batchId: string, rows: import('./parsers/creditDebitNote').ParsedCreditDebitNoteRow[]) {
  const db = supabaseAdmin();
  const productIds = await resolveProductIds('credit_debit_note', rows.map(r => r.productRaw));
  const toInsert: any[] = []; const seenThisBatch = new Set<string>();
  for (const r of rows) {
    if (seenThisBatch.has(r.referenceNumber)) continue;
    seenThisBatch.add(r.referenceNumber);
    toInsert.push({ upload_batch_id: batchId, po_no: r.poNo || null, date: r.date || null, purchase_type: r.purchaseType, invoice_no: r.invoiceNo, lot_no: r.lotNo || null, reference_number: r.referenceNumber, customer_name: r.customerName, product_id: productIds.get(r.productRaw) || null, product_raw: r.productRaw, net_weight: r.netWeight, final_weight: r.finalWeight, lab_oil: r.labOil, rep_oil: r.repOil, rate_type: r.rateType, bill_rate: r.billRate, final_rate: r.finalRate, jute_bag: r.juteBag, pack_rate: r.packRate, pack_cost: r.packCost, value: r.value, sgst: r.sgst, cgst: r.cgst, igst: r.igst, total_gst: r.totalGst, weightment: r.weightment, unloading: r.unloading, lorry_freight: r.lorryFreight, advance: r.advance, brokerage: r.brokerage, other_expenses: r.otherExpenses, tds: r.tds, net_value: r.netValue, bill_value: r.billValue, rebate_value: r.rebateValue, rebate_igst: r.rebateIgst, rebate_cgst: r.rebateCgst, rebate_sgst: r.rebateSgst, rebate_total_gst: r.rebateTotalGst, rebate_net_value: r.rebateNetValue });
  }
  let newRows = 0, duplicateRows = 0;
  if (toInsert.length) {
    const { data, error } = await db.from('ops_credit_debit_notes').upsert(toInsert, { onConflict: 'reference_number', ignoreDuplicates: true }).select('reference_number');
    if (error) throw new Error(`Credit / Debit Note insert failed: ${error.message}`);
    newRows = data?.length || 0;
    duplicateRows = toInsert.length - newRows;
  }
  return { newRows, duplicateRows, correctionFlags: 0 };
}

export async function processOpsUpload(reportType: ReportType, fileName: string, fileBuffer: Buffer, parsed: ParsedReport, uploadedBy: string | null): Promise<UploadResult> {
  const db = supabaseAdmin();
  const { batchId, duplicate, inProgress } = await openBatch(reportType, fileName, fileBuffer, uploadedBy);
  if (!batchId) {
    const message = inProgress ? 'This exact file is already being uploaded right now (from another request a moment ago) — wait for it to finish rather than resubmitting.' : `This exact ERP report has already been uploaded and processed (on ${duplicate.report_date || 'an unknown date'}).`;
    return { status: 'duplicate_file', batchId: null, reportDate: duplicate.report_date, versionNo: 0, supersededBatchId: null, totalRowsInFile: parsed.rows.length, newRowCount: 0, duplicateRowCount: 0, correctionFlaggedCount: 0, message, existingBatch: { id: duplicate.id, reportDate: duplicate.report_date, uploadedAt: duplicate.created_at } };
  }

  try {
    let counts: { newRows: number; duplicateRows: number; correctionFlags: number };
    if (parsed.reportType === 'feeding') counts = await persistFeeding(batchId, parsed.rows);
    else if (parsed.reportType === 'production') counts = await persistProduction(batchId, parsed.rows);
    else if (parsed.reportType === 'stock_snapshot') counts = await persistStockSnapshot(batchId, parsed.rows);
    else if (parsed.reportType === 'rm_batch_stock') counts = await persistRmBatchStock(batchId, parsed.rows);
    else if (parsed.reportType === 'purchase_order_pending') counts = await persistPurchaseOrderPending(batchId, parsed.rows);
    else if (parsed.reportType === 'purchase_details') counts = await persistPurchaseDetails(batchId, parsed.rows);
    else if (parsed.reportType === 'gate_in') counts = await persistGateMovements(batchId, 'IN', parsed.rows);
    else if (parsed.reportType === 'gate_out') counts = await persistGateMovements(batchId, 'OUT', parsed.rows);
    else if (parsed.reportType === 'time_office_in') counts = await persistWeighments(batchId, 'IN', parsed.rows, 'time_office_in');
    else if (parsed.reportType === 'time_office_out') counts = await persistWeighments(batchId, 'OUT', parsed.rows, 'time_office_out');
    else if (parsed.reportType === 'inward_qc') counts = await persistInwardQc(batchId, parsed.rows);
    else if (parsed.reportType === 'settlement_pending') counts = await persistSettlementPending(batchId, parsed.rows);
    else if (parsed.reportType === 'sale_order_details') counts = await persistSaleOrderDetails(batchId, parsed.rows);
    else if (parsed.reportType === 'sales_register') counts = await persistSalesRegister(batchId, parsed.rows);
    else if (parsed.reportType === 'purchase_receipts') counts = await persistPurchaseReceipts(batchId, parsed.rows);
    else if (parsed.reportType === 'brokerage') counts = await persistBrokerage(batchId, parsed.rows);
    else if (parsed.reportType === 'consumable_issue') counts = await persistConsumableIssue(batchId, parsed.rows);
    else if (parsed.reportType === 'eb_power_reading') counts = await persistEbPowerReadings(batchId, parsed.rows);
    else if (parsed.reportType === 'freight_summary') counts = await persistFreightSummary(batchId, parsed.rows);
    else if (parsed.reportType === 'qc_pending_lots') counts = await persistQcPendingLots(batchId, parsed.rows);
    else if (parsed.reportType === 'shut_down') counts = await persistShutDown(batchId, parsed.rows);
    else if (parsed.reportType === 'solvent_daily_report') counts = await persistSolventDailyReadings(batchId, parsed.rows);
    else if (parsed.reportType === 'contract_pending') counts = await persistContractPending(batchId, parsed.rows);
    else if (parsed.reportType === 'inward_payment') counts = await persistInwardPayments(batchId, parsed.rows);
    else if (parsed.reportType === 'purchase_summary') counts = await persistPurchaseSummary(batchId, parsed.rows);
    else counts = await persistCreditDebitNotes(batchId, parsed.rows);

    let versionNo = 1, supersededBatchId: string | null = null;
    if (SNAPSHOT_REPORT_TYPES.has(reportType)) { const v = await activateSnapshotBatch(reportType, batchId, parsed.reportDate); versionNo = v.versionNo; supersededBatchId = v.supersededBatchId; }

    // Checked: an unchecked failure here previously left a batch stuck at
    // status='processing' while the API still returned "completed" to the
    // caller — confirmed live (a batch's DB row silently never matched its
    // own API response). A failure here must surface, not be swallowed.
    const { error: completeErr } = await db.from('ops_upload_batches').update({ report_date: parsed.reportDate, row_count: parsed.rows.length, new_row_count: counts.newRows, duplicate_row_count: counts.duplicateRows, correction_flagged_count: counts.correctionFlags, status: 'completed', completed_at: new Date().toISOString() }).eq('id', batchId);
    if (completeErr) throw new Error(`Upload processed but could not finalize the batch record: ${completeErr.message}`);

    const parts = [`${counts.newRows} new`];
    if (counts.duplicateRows) parts.push(`${counts.duplicateRows} duplicate skipped`);
    if (counts.correctionFlags) parts.push(`${counts.correctionFlags} correction${counts.correctionFlags === 1 ? '' : 's'} flagged for review`);
    const message = (SNAPSHOT_REPORT_TYPES.has(reportType) && supersededBatchId ? `New version (v${versionNo}) activated — ` : '') + parts.join(', ');

    return { status: 'completed', batchId, reportDate: parsed.reportDate, versionNo, supersededBatchId, totalRowsInFile: parsed.rows.length, newRowCount: counts.newRows, duplicateRowCount: counts.duplicateRows, correctionFlaggedCount: counts.correctionFlags, message };
  } catch (error) {
    await db.from('ops_upload_batches').update({ status: 'failed', error_summary: [{ message: error instanceof Error ? error.message : String(error) }] }).eq('id', batchId);
    throw error;
  }
}
