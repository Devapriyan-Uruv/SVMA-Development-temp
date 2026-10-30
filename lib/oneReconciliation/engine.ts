import * as XLSX from 'xlsx';
import { randomUUID } from 'crypto';
import { parseWeighmentWithLot, parseGateUpload, parseTallyUpload, type Gate, type TallyVoucher, type WeighmentWithLot } from './parsers';
import { buildGateIndex, generateGateCandidates, narrowCandidates, type GateCandidate } from '@/lib/reconciliation/candidates';
import { scoreGateCandidate, scoreTallyCandidate, isDominant } from '@/lib/reconciliation/scoring';
import { nameSimilarity } from '@/lib/reconciliation/normalize';
import { referenceEquals, sameFamily } from '@/lib/reconciliation/reference';
import { DEFAULT_THRESHOLDS, DEFAULT_SEED_TAXONOMY, type ReconciliationProfile } from '@/lib/reconciliation/profile';
import { loadProductMaster, matchProduct, productFromLotRecord, type ProductMatch } from './productMaster';
import { classifyTransaction, type Category } from './classification';
import { buildSalesWithoutWeighment } from './salesOnly';
import { parseTallyLedger, buildLedgerIndex, type TallyLedgerVoucher } from './tallyLedger';
import { ingestReports } from './reports';
import { loadEvidence, loadGateBridge, loadLotUniverse, loadReceiptsInRange, loadTimeOfficeNets } from './evidence';
import { buildMasterRow, AMOUNT_TOLERANCE, QTY_TOLERANCE_MT, QTY_TOLERANCE_PCT, JUTE_KG_PER_BAG, PLASTIC_KG_PER_BAG, SETTLEMENT_WEIGHT_TOLERANCE_MT, type LotResolution } from './build';
import { OIL_TOLERANCE_POINTS } from './qcOil';
import { STATUS_PRIORITY, type MasterRow, type OneReconResult, type ReportUnderstanding, type UnlinkedRecord } from './master';
import { findUnlinked } from './unlinked';
import { reassignByWeight } from './reassign';
import type { LotRec, Prov } from './records';

// ONE engine: Upload -> understand every workbook -> Product Master
// normalization -> Purchase/Sales/Inter-Job Work/Others separation -> one
// Recon ID per weighment transaction -> chain walk across every available
// source (uploaded evidence first, Operations database second) -> ONE master
// row. Nothing is forced: anything that cannot be established deterministically
// is left as "Not Found"/REVIEW REQUIRED. AI is used only (a) to classify an
// unidentifiable uploaded workbook and (b) for ambiguous Product Master
// matches — once per unique text, never per transaction row.

// Synthetic empty profile: same calibrated thresholds/weights as the live
// engine (values-only import) but none of its learned tables — this feature
// never reads or writes the existing Transaction Reconciliation's state.
const SYNTHETIC_PROFILE: ReconciliationProfile = {
  version: 1, thresholds: DEFAULT_THRESHOLDS, seedTaxonomy: DEFAULT_SEED_TAXONOMY,
  partyAliases: [], materialAliases: [], documentFamilies: [], jobWorkRules: [],
};

export type OneReconInput = {
  weighmentBook: XLSX.WorkBook; weighmentFile: string;
  gateInBooks: { book: XLSX.WorkBook; file: string }[];
  gateOutBooks: { book: XLSX.WorkBook; file: string }[];
  /** The Day Book as a workbook (server-side parse) — or, for a large Day Book, already parsed in the browser (`tallyParsed`) so the server never opens the spreadsheet. */
  tallyBook?: XLSX.WorkBook; tallyParsed?: { vouchers: TallyVoucher[]; ledger: TallyLedgerVoucher[]; sheet?: string }; tallyFile: string;
  extraReports?: { file: string; book: XLSX.WorkBook }[];
  /** Additional files that could not be opened as a workbook at all. */
  extraUnreadable?: { file: string; message: string }[];
  reconciliationDate?: string;
};

const up = (s: unknown) => String(s ?? '').trim().toUpperCase();

type ScoredGate = { c: GateCandidate; score: number; evidence: string[] };
// scoreGateCandidate reads only fields baked into the candidate (never the
// weighment argument) — confirmed by reading scoring.ts in full.
const scoreAll = (candidates: GateCandidate[]): ScoredGate[] => candidates.map(c => ({ c, ...scoreGateCandidate({} as any, c, SYNTHETIC_PROFILE.thresholds.weights) })).sort((a, b) => b.score - a.score);
// A weighment's net weight equals the Time Office net of the gate pass it belongs to (same truck, same scale). Printed in MT
// or kg depending on the report, so either reading may match. Used ONLY to choose between near-tied gate passes.
const GATE_WEIGHT_FIT_KG = 5;
function weightGap(weight: number | null, tofNet: number | undefined): number | null {
  // A zero weight (an empty / cancelled weighing) equals every other zero and says nothing about which gate pass it is.
  if (!weight || !tofNet || weight <= 0 || tofNet <= 0) return null;
  return Math.min(Math.abs(tofNet - weight), Math.abs(tofNet * 1000 - weight));
}
function pickGateCandidate(scored: ScoredGate[], claimed: Set<string>, weight: number | null = null, tofNets?: Map<string, { net: number; lotNo: string }>): { candidate: GateCandidate | null; score: number; evidence: string[] } {
  if (!scored.length) return { candidate: null, score: 0, evidence: [] };
  // Several loads of one vehicle on one day look identical by vehicle/material/party (a tie). The gate pass whose Time Office
  // net equals this weighment's own net is the right one; anything not tied is untouched.
  if (tofNets && weight != null) {
    const open = scored.filter(s => !claimed.has(up(s.c.gate.gp)));
    const band = open.filter(s => s.score >= open[0].score - SYNTHETIC_PROFILE.thresholds.dominantMargin);
    const fits = band.map(s => ({ s, gap: weightGap(weight, tofNets.get(up(s.c.gate.gp))?.net) })).filter((x): x is { s: ScoredGate; gap: number } => x.gap != null && x.gap <= GATE_WEIGHT_FIT_KG).sort((a, b) => a.gap - b.gap);
    if (band.length > 1 && fits.length && fits[0].s !== open[0] && (fits.length === 1 || fits[1].gap > fits[0].gap)) {
      const pick = fits[0].s;
      return { candidate: pick.c, score: pick.score, evidence: [...pick.evidence, 'gate pass chosen by Time Office net weight (same vehicle, several similar gate records)'] };
    }
  }
  // A single physical gate entry is ONE truck visit — it can never be the
  // evidence for two different weighments (confirmed live: two different
  // loads from the same vehicle on the same day were both independently
  // scoring highest against the SAME gate pass, with nothing stopping both
  // from claiming it). Candidates already claimed by an earlier (always
  // higher- or equal-scoring, since callers process weighments best-first)
  // weighment are skipped in favor of this weighment's own next-best.
  const pick = scored.find(s => !claimed.has(up(s.c.gate.gp)));
  if (!pick) return { candidate: null, score: 0, evidence: [] };
  const evidence = [...pick.evidence];
  if (!isDominant(scored, SYNTHETIC_PROFILE.thresholds.dominantMargin)) evidence.push('several similarly-scored gate records — best selected');
  return { candidate: pick.c, score: pick.score, evidence };
}

function resolveLot(w: WeighmentWithLot, universe: LotRec[], bridgeLot: { lotNo: string; prov: Prov } | undefined, po: string, productIds: string[]): LotResolution {
  const none: LotResolution = { lotNo: null, source: 'none', confidence: 0, rec: null, bridgeProv: null };
  const recFor = (lotNo: string) => universe.find(l => up(l.lotNo) === up(lotNo)) || null;
  const token = w.lot.replace(/\s+/g, '').toUpperCase();
  if (token) {
    const cands = universe.filter(l => up(l.lotNo) === token || up(l.lotNo).split('/').includes(token));
    const distinct = [...new Set(cands.map(c => up(c.lotNo)))];
    if (distinct.length === 1) {
      // The weighment's own typed Lot No is a free-text field — confirmed
      // live to carry operator typos (the same lot number mistakenly typed
      // for a second truckload that Time Office, via its own distinct Gate
      // Pass, correctly shows is a DIFFERENT lot). The Gate Pass -> Time
      // Office bridge is tied to this specific weighment's own gate entry
      // (unique per weighment since gate assignment itself is exclusive),
      // so when it disagrees with the typed field, it is the more reliable
      // source and wins.
      if (bridgeLot && up(bridgeLot.lotNo) !== distinct[0]) return { lotNo: bridgeLot.lotNo, source: 'weighment_bridge', confidence: 0.9, rec: recFor(bridgeLot.lotNo) || { lotNo: bridgeLot.lotNo, poNo: '', productId: null, productRaw: null, prov: bridgeLot.prov }, bridgeProv: bridgeLot.prov };
      return { lotNo: cands[0].lotNo, source: 'file_resolved', confidence: token === distinct[0] ? 1 : 0.95, rec: cands[0], bridgeProv: null };
    }
    if (distinct.length > 1) {
      // Same serial under several product prefixes. Ladder, each step accepted
      // only if it leaves exactly one lot: Time Office bridge lot for this gate
      // pass -> lot whose PO equals the gate's PO -> lot whose product equals a
      // Product-Master-matched product. Otherwise ambiguous, never guessed.
      const steps: (() => string[])[] = [
        () => (bridgeLot && distinct.includes(up(bridgeLot.lotNo)) ? [up(bridgeLot.lotNo)] : []),
        () => [...new Set(cands.filter(c => po && up(c.poNo) === up(po)).map(c => up(c.lotNo)))],
        () => [...new Set(cands.filter(c => c.productId && productIds.includes(c.productId)).map(c => up(c.lotNo)))],
      ];
      for (const s of steps) { const r = s(); if (r.length === 1) return { lotNo: cands.find(c => up(c.lotNo) === r[0])!.lotNo, source: 'file_resolved', confidence: 0.85, rec: cands.find(c => up(c.lotNo) === r[0])!, bridgeProv: null }; }
      return { ...none, source: 'ambiguous' };
    }
    if (!bridgeLot) return { ...none, source: 'file_unresolved' };
  }
  if (bridgeLot) return { lotNo: bridgeLot.lotNo, source: 'weighment_bridge', confidence: 0.95, rec: recFor(bridgeLot.lotNo) || { lotNo: bridgeLot.lotNo, poNo: '', productId: null, productRaw: null, prov: bridgeLot.prov }, bridgeProv: bridgeLot.prov };
  return none;
}

export async function runOneReconciliation(input: OneReconInput): Promise<OneReconResult> {
  const runId = `RUN-${randomUUID().slice(0, 8).toUpperCase()}`;
  const warnings: string[] = [];

  const { rows: weighments, date, notes: weighmentNotes } = parseWeighmentWithLot(input.weighmentBook, input.weighmentFile, input.reconciliationDate || '');
  warnings.push(...weighmentNotes);
  const weighDates = Array.from(new Set(weighments.map(w => w.date).filter(Boolean))).sort();
  const gates: Gate[] = [
    ...input.gateInBooks.flatMap(({ book, file }) => parseGateUpload(book, file, 'IN')),
    ...input.gateOutBooks.flatMap(({ book, file }) => parseGateUpload(book, file, 'OUT')),
  ];
  if (!input.tallyBook && !input.tallyParsed) throw new Error('The Tally Day Book is missing.');
  const { vouchers } = input.tallyParsed ? { vouchers: input.tallyParsed.vouchers } : parseTallyUpload(input.tallyBook!, input.tallyFile);
  const ledger = buildLedgerIndex(input.tallyParsed ? input.tallyParsed.ledger : parseTallyLedger(input.tallyBook!, input.tallyFile));
  const { bundle, understanding: extraUnderstanding } = await ingestReports(input.extraReports || []);

  const understanding: ReportUnderstanding[] = [
    { file: input.weighmentFile, detectedType: 'weighment', label: 'Weighment Register', confidence: 1, method: 'upload slot', sheet: input.weighmentBook.SheetNames[0] || '', rows: weighments.length, status: 'used', note: `${weighments.length} weighment(s) — each becomes one reconciliation row.` },
    ...input.gateInBooks.map(({ book, file }) => ({ file, detectedType: 'gate_in', label: 'Gate In', confidence: 1, method: 'upload slot', sheet: book.SheetNames[0] || '', rows: gates.filter(g => g.direction === 'IN' && g.source.file === file).length, status: 'used' as const, note: 'Gate entries with PO and supplier invoice.' })),
    ...input.gateOutBooks.map(({ book, file }) => ({ file, detectedType: 'gate_out', label: 'Gate Out', confidence: 1, method: 'upload slot', sheet: book.SheetNames[0] || '', rows: gates.filter(g => g.direction === 'OUT' && g.source.file === file).length, status: 'used' as const, note: 'Gate entries with SO / invoice reference.' })),
    { file: input.tallyFile, detectedType: 'tally', label: 'Tally Day Book', confidence: 1, method: 'upload slot', sheet: input.tallyParsed?.sheet || input.tallyBook?.SheetNames[0] || '', rows: vouchers.length, status: 'used', note: `${vouchers.length} voucher(s), ${ledger.byNewRef.size} New Ref and ${ledger.paymentsByLot.size} lot-based Agst Ref key(s).` },
    ...extraUnderstanding,
    ...(input.extraUnreadable || []).map(u => ({ file: u.file, detectedType: null, label: 'Unreadable', confidence: 0, method: 'none', sheet: '', rows: 0, status: 'error' as const, note: `${u.message} Upload the report as .xlsx/.xls.` })),
  ];

  const gateIndex = buildGateIndex(gates);
  const productIndex = await loadProductMaster();

  // ---- Gate candidates (global uniqueness) + product matching --------------
  const gateScored = new Map<string, { narrowed: GateCandidate[]; scored: ScoredGate[] }>();
  for (const w of weighments) {
    const narrowed = narrowCandidates(generateGateCandidates(w, gateIndex, SYNTHETIC_PROFILE.thresholds), SYNTHETIC_PROFILE.thresholds);
    gateScored.set(w.id, { narrowed, scored: scoreAll(narrowed) });
  }
  // Assign highest-scoring weighment first, so a genuinely strong match
  // never loses its correct gate to a weaker one that merely got processed
  // first — see pickGateCandidate for why this must be exclusive at all.
  // Time Office net per candidate gate pass, to break ties between same-vehicle loads (see pickGateCandidate).
  const tofNets = await loadTimeOfficeNets(bundle, [...new Set([...gateScored.values()].flatMap(g => g.scored.map(s => s.c.gate.gp)))]);
  const weightById = new Map(weighments.map(w => [w.id, w.weight]));
  // A weighment whose net equals one of its candidate gate passes' Time Office net claims it first.
  // Only for weighments that actually have a near-tie between gate passes; everyone else keeps the original order.
  const hasFit = (wid: string, scored: ScoredGate[]) => scored.length > 1 && scored.filter(s => s.score >= scored[0].score - SYNTHETIC_PROFILE.thresholds.dominantMargin).some((s, _i, band) => band.length > 1 && (() => { const g = weightGap(weightById.get(wid) ?? null, tofNets.get(up(s.c.gate.gp))?.net); return g != null && g <= GATE_WEIGHT_FIT_KG; })());
  const gateOrder = [...gateScored.entries()].sort((a, b) => (Number(hasFit(b[0], b[1].scored)) - Number(hasFit(a[0], a[1].scored))) || ((b[1].scored[0]?.score ?? 0) - (a[1].scored[0]?.score ?? 0)));
  const claimedGates = new Set<string>();
  const gatePass = new Map<string, { narrowed: GateCandidate[]; best: ReturnType<typeof pickGateCandidate> }>();
  for (const [wid, { narrowed, scored }] of gateOrder) {
    const best = pickGateCandidate(scored, claimedGates, weightById.get(wid) ?? null, tofNets);
    if (best.candidate) claimedGates.add(up(best.candidate.gate.gp));
    gatePass.set(wid, { narrowed, best });
  }
  const uniqueMaterials = [...new Set([...weighments.map(w => w.material), ...[...gatePass.values()].map(g => g.best.candidate?.gate.material || '').filter(Boolean)])];
  const productByMaterial = new Map<string, ProductMatch>();
  for (let i = 0; i < uniqueMaterials.length; i += 6) {
    const batch = uniqueMaterials.slice(i, i + 6);
    const matches = await Promise.all(batch.map(m => matchProduct(m, productIndex)));
    batch.forEach((m, j) => productByMaterial.set(m, matches[j]));
  }

  type Prepared = { w: WeighmentWithLot; product: ProductMatch; gateProduct: ProductMatch | null; category: Category; categoryReason: string; gate: Gate | null; gateScore: number; gateEvidence: string[] };
  const prepared: Prepared[] = weighments.map(w => {
    const { narrowed, best } = gatePass.get(w.id)!;
    const product = productByMaterial.get(w.material)!;
    const { category, reason } = classifyTransaction(w.material, w.party, product, narrowed);
    const gate = best.candidate?.gate ?? null;
    return { w, product, gateProduct: gate?.material ? productByMaterial.get(gate.material) || null : null, category, categoryReason: reason, gate, gateScore: best.score, gateEvidence: best.evidence };
  });

  // ---- Lot resolution ------------------------------------------------------
  const gatePassNos = prepared.map(p => p.gate?.gp).filter((v): v is string => !!v);
  const bridge = await loadGateBridge(bundle, gatePassNos);
  const tokens = [...prepared.map(p => p.w.lot.replace(/\s+/g, '').toUpperCase()).filter(Boolean), ...[...bridge.values()].map(b => up(b.lotNo))];
  const lotUniverse = await loadLotUniverse(bundle, tokens);
  const lots = new Map<string, LotResolution>();
  for (const p of prepared) {
    const po = p.gate?.direction === 'IN' ? p.gate.order : '';
    const productIds = [p.product.masterProductId, p.gateProduct?.masterProductId].filter((v): v is string => !!v);
    lots.set(p.w.id, resolveLot(p.w, lotUniverse, p.gate ? bridge.get(up(p.gate.gp)) : undefined, po, productIds));
  }

  // ---- Downstream evidence (batched once per run) ---------------------------
  const needs = () => ({
    lots: [...lots.values()].map(l => l.lotNo).filter((v): v is string => !!v),
    poNos: prepared.map(p => (p.gate?.direction === 'IN' ? p.gate.order : '')).filter(Boolean),
    soNos: prepared.map(p => (p.gate?.direction === 'OUT' ? p.gate.order : '')).filter(Boolean),
    invoiceNos: prepared.map(p => p.gate?.invoice || '').filter(Boolean),
    gatePasses: gatePassNos,
    vehicles: [...new Set(prepared.map(p => p.w.vehicle).filter(Boolean))],
  });
  let evidence = await loadEvidence(bundle, needs(), lotUniverse);

  // Gunny rate (Rs/bag) a supplier was charged on other lots in this run — used only to point out a lot that has none.
  const gunnyRates = new Map<string, { rate: number; lots: number }>();
  for (const list of evidence.cdnByLot.values()) for (const c of list) {
    if (!(c.packRate && c.packRate > 0) || !(c.juteBag && c.juteBag > 0)) continue;
    const k = up(c.customerName).replace(/[^A-Z0-9]/g, ''); if (!k) continue;
    const cur = gunnyRates.get(k); gunnyRates.set(k, { rate: Math.max(cur?.rate ?? 0, c.packRate), lots: (cur?.lots ?? 0) + 1 });
  }

  // ---- Tally booking candidate (existing scorer, reused) ---------------------
  // Speed only, identical results: scoreTallyCandidate immediately disqualifies Payment/Receipt/Journal
  // ("SUPPORTING") vouchers and a register of the opposite direction, and bookingScore already skips
  // disqualified ones — so they are filtered out once instead of being scored for every weighment, in the
  // same order. Results are also remembered per weighment+gate+category, because the split-load pass below
  // asks the identical question a second time. A month of weighments went from ~150 s to a fraction of that.
  const eligible = vouchers.filter(v => v.stage !== 'SUPPORTING');
  const poolFor = (category: string) => category === 'Purchase' ? eligible.filter(v => v.sheetRole !== 'sales_register') : category === 'Sales' ? eligible.filter(v => v.sheetRole !== 'purchase_register') : eligible;
  const pools: Record<string, TallyVoucher[]> = { Purchase: poolFor('Purchase'), Sales: poolFor('Sales') };
  // Party-name similarity is the expensive part of scoring a voucher and the same few hundred names meet each
  // other over and over, so it is computed once per pair.
  const simMemo = new Map<string, number>();
  const sim = (a: string, b: string) => { const k = `${a}\u0000${b}`; let s = simMemo.get(k); if (s === undefined) { s = nameSimilarity(a, b); simMemo.set(k, s); } return s; };
  const NAME_THRESHOLD = SYNTHETIC_PROFILE.thresholds.tallyNameThreshold;
  // Bills of non-stock transactions (maintenance, store material, services): purchase vouchers that do not book a lot.
  const nonStockVouchers = [...ledger.byKey.values()].filter(v => /purchase/i.test(v.vchType) && !/order/i.test(v.vchType) && !v.refs.some(r => /new ref/i.test(r.kind) && /^[A-Z][A-Z0-9-]*\/\d{6,8}\/\d{2}-\d{2}/i.test(r.ref.replace(/\s+/g, ''))));
  // Tally water suppliers that a weighbridge name already identifies (Nagaraj <- "NAGARAJ"); the rest are matched by elimination.
  const weighmentParties = [...new Set(weighments.map(w => w.party).filter(Boolean))];
  const claimedSuppliers = new Set([...ledger.waterSuppliers.keys()].filter(sName => weighmentParties.some(p => sim(p, sName) >= 0.8)));
  const bookingMemo = new Map<string, { v: TallyVoucher; score: number; evidence: string[] } | null>();
  const bookingScore: Parameters<typeof buildMasterRow>[0]['bookingScore'] = (w, gate, category) => {
    const memoKey = `${category}|${w.id}|${gate?.gp ?? ''}`;
    if (bookingMemo.has(memoKey)) return bookingMemo.get(memoKey)!;
    const orderRefs = [gate?.order, w.ref].filter((v): v is string => !!v);
    let best: { v: TallyVoucher; score: number; evidence: string[] } | null = null;
    for (const v of pools[category] || eligible) {
      // scoreTallyCandidate ends with "no reference or party evidence -> disqualified" when no reference/family
      // link exists and the party similarity is below the threshold. That exact condition is checked here first
      // (same inputs, same helpers) so those vouchers are not fully scored — results are unchanged.
      const partyScore = Math.max(sim(w.party, v.party), gate?.party ? sim(gate.party, v.party) : 0);
      if (partyScore < NAME_THRESHOLD && !orderRefs.some(o => referenceEquals(o, v.orderRef) || referenceEquals(o, v.vchNo) || sameFamily(o, v.orderRef) || sameFamily(o, v.vchNo))) continue;
      // scoreTallyCandidate only compares category to 'Purchase'/'Sales'.
      const r = scoreTallyCandidate(category as any, w, gate, orderRefs, v, SYNTHETIC_PROFILE);
      if (r.disqualified) continue;
      if (!best || r.score > best.score) best = { v, score: r.score, evidence: r.evidence };
    }
    const picked = best && best.score >= SYNTHETIC_PROFILE.thresholds.secondPassMin ? best : null;
    bookingMemo.set(memoKey, picked);
    return picked;
  };

  let tallyExclusions = new Map<string, Set<string>>();
  const buildAll = (groups?: Map<string, { size: number; netKg: number; tallyAmount: number | null }>, excl?: Map<string, Set<string>>) => prepared.map((p, i) => buildMasterRow({
    runId, seq: i + 1, date: p.w.date || date,
    w: p.w, product: p.product, gateProduct: p.gateProduct, category: p.category, categoryReason: p.categoryReason,
    gate: p.gate, gateScore: p.gateScore, gateEvidence: p.gateEvidence, lot: lots.get(p.w.id)!,
    group: groups?.get(p.w.id), excludeErp: excl?.get(p.w.id), excludeTally: tallyExclusions.get(p.w.id), gunnyRates,
    evidence, ledger, tallyVouchers: vouchers, bookingScore, nonStockVouchers, partySim: sim, claimedSuppliers,
  }));
  // A material typed as just "BRAN" cannot be matched on its own, yet the ERP lot it belongs to knows its product.
  const lotProductCache = new Map<string, ProductMatch | null>();
  const applyLotProducts = async () => {
    for (const p of prepared) {
      if (p.product.matchMethod !== 'not_found') continue;
      const lot = lots.get(p.w.id);
      if (!lot?.lotNo) continue;
      const receiptProduct = (evidence.receiptsByLot.get(up(lot.lotNo)) || [])[0]?.product || '';
      const key = `${p.w.material}|${lot.rec?.productId ?? ''}|${receiptProduct}`;
      if (!lotProductCache.has(key)) lotProductCache.set(key, await productFromLotRecord(p.w.material, lot.rec?.productId ?? null, receiptProduct, productIndex));
      const m = lotProductCache.get(key);
      if (m) p.product = m;
    }
  };
  await applyLotProducts();
  let rows: MasterRow[] = buildAll();
  // Material typed at the weighbridge that matches no Product Master product takes the product of the ERP record it is linked to
  // (purchase receipt or sales invoice) — the ERP's own product names are the master's names. Rebuilt once if anything changed.
  const applyErpProducts = async (): Promise<boolean> => {
    let changed = false;
    for (let i = 0; i < prepared.length; i++) {
      const p = prepared[i], raw = rows[i].erpProductRaw;
      // Not matched at all, or matched only to a family ("RICE BRAN"): the ERP record's own product is the specific one.
      if (!(p.product.matchMethod === 'not_found' || (p.product.matchMethod === 'category' && !p.product.masterProductId)) || !raw) continue;
      const m = await matchProduct(raw, productIndex, { allowAi: false });
      if (m.matchMethod === 'not_found' || !m.masterProductId) continue;
      p.product = { ...m, raw: p.w.material, normalized: p.product.normalized, matchMethod: 'erp_record', matchConfidence: Math.min(0.9, m.matchConfidence) }; changed = true;
    }
    return changed;
  };
  if (await applyErpProducts()) rows = buildAll();

  // Same-vehicle loads whose lot is the other load's: give an unsettled load the one unclaimed ERP receipt of its vehicle
  // whose weight agrees (see reassign.ts), then rebuild so QC / Settlement / Tally follow the corrected lot.
  const rangeReceipts = weighDates.length ? await loadReceiptsInRange(bundle, weighDates[0], weighDates[weighDates.length - 1]).catch(() => []) : [];
  const reassigned = reassignByWeight(rows, weighments, rangeReceipts);
  if (reassigned.size) {
    for (const [wid, r] of reassigned) lots.set(wid, { lotNo: r.lotNo, source: 'weight_reassigned', confidence: 0.9, rec: { lotNo: r.lotNo, poNo: r.receipt.poNo, productId: null, productRaw: r.receipt.product, prov: r.receipt.prov }, bridgeProv: null, note: r.note });
    evidence = await loadEvidence(bundle, needs(), lotUniverse);
    await applyLotProducts();
    rows = buildAll();
    if (await applyErpProducts()) rows = buildAll();
  }

  // One Tally voucher, one transaction: where a voucher is linked to a weighment through the voucher's OWN ERP document (its number is that
  // weighment's ERP reference), no other weighment may also take it by name scoring.
  {
    const byVoucher = new Map<string, number[]>();
    rows.forEach((r, i) => { for (const k of String(r.v.tallyVoucherNo).split(' + ')) { const no = up(k); if (no && no !== 'NOT FOUND' && no !== 'N/A') (byVoucher.get(no) || byVoucher.set(no, []).get(no)!).push(i); } });
    for (const [no, idxs] of byVoucher) {
      if (idxs.length < 2) continue;
      const owners = idxs.filter(i => [rows[i].v.erpReference, rows[i].v.erpInvoice].some(x => String(x).split(' + ').some(y => up(y) === no)));
      if (owners.length !== 1) continue;
      for (const i of idxs) if (i !== owners[0]) (tallyExclusions.get(prepared[i].w.id) || tallyExclusions.set(prepared[i].w.id, new Set()).get(prepared[i].w.id)!).add(no);
    }
    if (tallyExclusions.size) rows = buildAll();
  }

  // Split loads: several weighments can settle against ONE ERP receipt/invoice.
  // Compare the combined weighbridge total and the distinct Tally bookings of
  // the whole group rather than a single load against the whole receipt.
  const byErp = new Map<string, number[]>();
  rows.forEach((r, i) => { const k = String(r.v.erpReference); if (k !== 'Not Found' && k !== 'N/A') (byErp.get(k) || byErp.set(k, []).get(k)!).push(i); });
  const groups = new Map<string, { size: number; netKg: number; tallyAmount: number | null }>();
  const excl = new Map<string, Set<string>>();
  for (const idxs of byErp.values()) {
    if (idxs.length < 2) continue;
    const netKg = idxs.reduce((s, i) => s + (prepared[i].w.weight ?? 0), 0);
    // If exactly one load's own weight equals the ERP quantity (and the total does not), that load owns the record; the others do not.
    const erpQty = Number(rows[idxs[0]].v.erpQuantity);
    if (Number.isFinite(erpQty)) {
      const fits = (kg: number) => Math.abs(kg / 1000 - erpQty) <= Math.max(QTY_TOLERANCE_MT, QTY_TOLERANCE_PCT * erpQty);
      const owners = idxs.filter(i => fits(prepared[i].w.weight ?? 0));
      if (owners.length === 1 && !fits(netKg)) {
        const ref = String(rows[idxs[0]].v.erpReference).toUpperCase();
        for (const i of idxs) if (i !== owners[0]) excl.set(prepared[i].w.id, new Set([ref]));
        continue;
      }
    }
    const seen = new Map<string, number>();
    for (const i of idxs) { const no = String(rows[i].v.tallyVoucherNo), amt = rows[i].v.tallyAmount; if (typeof amt === 'number') seen.set(no, amt); }
    const tallyAmount = seen.size ? [...seen.values()].reduce((s, x) => s + x, 0) : null;
    for (const i of idxs) groups.set(prepared[i].w.id, { size: idxs.length, netKg, tallyAmount });
  }
  if (groups.size || excl.size) rows = buildAll(groups, excl);

  const byStatus: Record<string, number> = {}, byType: Record<string, number> = {};

  // ERP receipts / Tally purchase bookings dated in the run that have no weighment row (listed on their own sheet).
  let unlinked: UnlinkedRecord[] = [];
  if (weighDates.length) {
    unlinked = findUnlinked(rows, rangeReceipts, ledger, weighDates[0], weighDates[weighDates.length - 1]);
  }
  // ERP sales invoices with no weighment row: display rows for the SALES sheet / Sales view only (not part of `rows` or the summary).
  const salesNoWeighment = weighDates.length ? await buildSalesWithoutWeighment({ runId, rows, invoices: bundle.salesInvoices, ledger, productIndex, from: weighDates[0], to: weighDates[weighDates.length - 1] }) : [];
  for (const s of STATUS_PRIORITY) byStatus[s] = rows.filter(r => r.statuses.includes(s)).length;
  for (const r of rows) byType[r.transactionType] = (byType[r.transactionType] || 0) + 1;

  if (!vouchers.length) warnings.push('The uploaded Tally file produced zero recognized vouchers.');
  if (!gates.length) warnings.push('No Gate In/Out records were uploaded or recognized.');
  if (ledger.coverage && weighDates.length && (weighDates[weighDates.length - 1] > ledger.coverage.to || weighDates[0] < ledger.coverage.from)) warnings.push(`The uploaded Tally Day Book covers ${ledger.coverage.from} to ${ledger.coverage.to}, but the weighments run from ${weighDates[0]} to ${weighDates[weighDates.length - 1]}. Tally bookings and payments outside the Day Book's dates cannot be found — upload a Day Book that covers the whole period.`);
  if (unlinked.length) warnings.push(`${unlinked.filter(u => u.source === 'ERP receipt').length} ERP receipt(s) and ${unlinked.filter(u => u.source === 'Tally booking').length} Tally purchase booking(s) in this period have no weighment row — see the UNLINKED RECORDS sheet.`);
  if (salesNoWeighment.length) warnings.push(`${salesNoWeighment.length} ERP sales invoice(s) in this period have no weighment row (single-weight vehicles, or weighed on another weighbridge) — they are listed at the end of the SALES sheet.`);
  if (!(input.extraReports || []).length) warnings.push('No additional ERP reports were uploaded — ERP, QC, Settlement and CN/DN evidence came from the Operations database only.');
  const unused = understanding.filter(u => u.status !== 'used');
  if (unused.length) warnings.push(`${unused.length} additional file(s) could not be used: ${unused.map(u => u.file).join(', ')}.`);

  // Display-only summary date: a single day when the Weighment Register was
  // exactly that, or a span when the file (and so this run) combined several
  // days in one go. `date` from the parser is '' in the multi-day case —
  // every row's own date already drove its Recon ID and every comparison
  // above, this is purely what the header/export/persisted run show.
  const reconciliationDate = weighDates.length <= 1 ? (weighDates[0] || date) : `${weighDates[0]} to ${weighDates[weighDates.length - 1]}`;
  if (weighDates.length > 1) warnings.push(`This run combines ${weighDates.length} weighment dates (${weighDates[0]} to ${weighDates[weighDates.length - 1]}) in one reconciliation.`);

  return {
    runId, reconciliationDate, rows, understanding, warnings,
    unlinked, salesNoWeighment,
    summary: { total: rows.length, byStatus, byType, productNotFound: rows.filter(r => r.product.matchMethod === 'not_found').length, unlinkedErp: unlinked.filter(u => u.source === 'ERP receipt').length, unlinkedTally: unlinked.filter(u => u.source === 'Tally booking').length },
    definitions: [
      'One transaction = one Recon ID = one row. Filtered views and the Excel filter sheets are the same rows, never re-reconciled.',
      '"Not Found" = the value was expected for this transaction but no source record contained it. "N/A" = the value does not apply (e.g. QC Oil for Palm Kernel/Copra, Resettlement with no source report).',
      'Evidence priority per key: uploaded reports first, then the Operations database. Every matched value records its source file, sheet, row, raw and normalized value, rule, confidence and Run ID (Audit Trail).',
      'Oil Difference = JMD/Report Oil − QC Lab Oil (Rice Bran only). QC Lab Oil is never overwritten by the Report Oil.',
      `OIL MISMATCH when |Oil Difference| > ${OIL_TOLERANCE_POINTS} percentage points.`,
      `Quantity Difference = Weighbridge Net (MT) less the bags − ERP Quantity (MT). The ERP weighs the load less its bags: ${JUTE_KG_PER_BAG} kg per jute bag, and ${PLASTIC_KG_PER_BAG} kg per plastic bag for the products that carry them; the basis that lands on the ERP figure is shown in "ERP Weight Basis". QUANTITY MISMATCH when the difference stays beyond max(${QTY_TOLERANCE_MT} MT, ${QTY_TOLERANCE_PCT * 100}% of weighbridge net) after the bags.`,
      `Settlement Net Value is the Credit/Debit Note's value and it is FINAL: bill value + GST ± the note's rebate (a Credit Note adds, a Debit Note subtracts) − weighing − unloading − TDS. The GST rate is the note's own (5% for almost every lot, 0% for broken rice). Tally must agree: "Tally Settlement Value" = Tally booking − debit postings (charges, debit note) + credit postings (credit note); "Tally − Note Difference" and "Settlement Check" say exactly what differs (booking without GST, debit/credit note not posted or different, part payment).`,
      'Advance suppliers (the note\'s Advance column is the whole bill, or the payment equals the bill less TDS/charges) are paid up front: Payment Status = ADVANCE PAID, and "Balance To Settle" is the note value less what was paid (positive = still to pay the supplier, negative = to recover). That is not an AMOUNT MISMATCH. PAID / PART PAID / OVER PAID / NOT PAID otherwise.',
      `Settlement Weight check (information only): the Credit/Debit Note settles on the weighbridge net less jute (${JUTE_KG_PER_BAG} kg/bag). Settlement Weight − Net After Jute beyond ${SETTLEMENT_WEIGHT_TOLERANCE_MT} MT is called out in the comment, with its rupee effect at the note's own rate (Value / Final Weight).`,
      'Non-stock transactions (water, store material, services: no PO, lot or ERP receipt) are reconciled to their Tally bill (a purchase voucher of the same party within days) and its payment. Weekly water payments name a date range ("29.08.26 to 04.09.26") that covers every trip in it; a weighbridge name that is no Tally ledger is matched to the water supplier no other name accounts for, and flagged for confirmation. Payment Status shows whether each is paid.',
      'Job-work invoices (JW...) are not booked in Tally (none exists in the Day Book), so no Tally voucher is expected; their weight is the invoice kg column (the MT/No\'s column is a bag count).',
      'Sales invoices are linked by the gate invoice/SO first, then by vehicle + date + weight; one weighment can carry several invoices (two parties on one truck), compared on their total. One Tally voucher belongs to one transaction.',
      'Tally purchase bookings are matched on exact keys first: the booking voucher number equals the ERP receipt number, or its "New Ref" carries the lot (lot + supplier invoice). Party-name scoring is used only when no exact key applies, and a voucher whose own New Ref books a different lot is never taken.',
      'Same-vehicle loads: when several gate passes of one vehicle tie, the gate pass whose Time Office net weight equals the weighment\'s own net is chosen. UNLINKED RECORDS lists ERP receipts and Tally purchase bookings in the period that have no weighment row, with the nearest same-vehicle weighments and the likely reason.',
      `Amount Difference = ERP Amount − Tally booking amount. Payment Difference = Settlement Net Value − Tally payment (Agst Ref) total. AMOUNT MISMATCH when either differs by more than ₹${AMOUNT_TOLERANCE}.`,
      'Composite references such as RB-G2/091403/26-27/129 are split into lot + supplier invoice; the invoice part is accepted only when it equals the Gate Entry supplier invoice, never assumed by position.',
      'A Tally payment ("Agst Ref") line belonging to the SAME voucher already matched as the booking is never counted a second time as a separate payment — it is the booking\'s own reconciliation note, not new cash movement.',
      'The GST/charges columns come from the Credit/Debit Note report, Purchase (raw material) transactions only: the ERP-section Bill Value/GST/IGST/Total Value are the note\'s "Value" and its own SGST/CGST/IGST (GST = SGST+CGST combined, Total Value = Value + Total GST), shown early as a cross-check against ERP Amount. The Settlement-section SGST/CGST/IGST after Bill Value are the SAME bill-side GST; the SGST/CGST/IGST after Rebate are the note\'s rebate-side GST (tied to Rebate Value). WEIGHING CHARGES/UNLOADING CHARGES/TDS are the note\'s own charge lines. Upload the Credit/Debit Note report to populate these; without it they read Not Found.',
      'SALES sheet: laid out to the client\'s debtors format. IGST/CGST/SGST are derived from the Sales Register TaxAmount: intra-state (Tamil Nadu) = CGST + SGST (half each), inter-state = IGST, decided by the customer place. Receipts are the credit "Agst Ref" lines on Receipt vouchers whose reference is the ERP invoice number (the 3rd receipt column totals any further receipts). Quality Cut = invoice total − all Tally credits against the invoice, shown only when a receipt exists and the gap is at most 2% of the invoice; a larger gap is a balance outstanding. LOCAL SALES, TDS and WEIGHT SHORTAGE have no source yet and stay empty.',
      'SALES sheet additions: it also lists every Inter/Job Work row that carries an ERP sales invoice (sales to group companies such as SVMA Soya Foods or Maxi Bio) — the row keeps its Inter/Job Work type and status everywhere else — and, at the end, every ERP sales invoice of the period that has no weighment row (a single-weight vehicle, or one weighed on another weighbridge). SALE TYPE = Direct sale / Group company / Job work. WEIGHMENT PARTY is who the weighbridge says the load was delivered to (it can differ from the invoice party, e.g. goods invoiced to Soya Foods but delivered to the end customer); WEIGHMENT says whether the load had gross and tare, a single weight, or no weighment record.',
      'Firewood is a purchase by nature: with no Gate record linked it is classified as Purchase (not Others), reconciled to its Tally bill and payment like other non-stock purchases.',
      'Resettlement: no Resettlement source report exists in the current report set, so Resettlement fields are N/A and RESETTLEMENT PENDING is never raised.',
      'AI is never used to invent a value. It is used only to classify an unidentifiable workbook and to suggest Product Master matches for ambiguous material text (once per unique text). The comment column is generated from the matched facts.',
    ],
  };
}
