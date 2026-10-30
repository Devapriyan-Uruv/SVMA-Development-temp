import * as XLSX from 'xlsx';
import { parseWeighmentUpload, parseGateUpload, parseTallyUpload, type Gate, type TallyVoucher, type Weighment } from './parsers';
import { buildGateIndex, generateGateCandidates, narrowCandidates, type GateCandidate } from './candidates';
import { classifyWeighment, type Category } from './classification';
import { scoreGateCandidate, scoreTallyCandidate, bandFor, isDominant, type ActionBand } from './scoring';
import { resolveGlobalAssignment, type WeighmentMatchState, type ConsolidatedGroup } from './globalAssignment';
import { resolveSecondPass, explainAutoReconciled, type SecondPassCase } from './aiResolver';
import { observeFromGateIn, observeFromGateOut, observeFromTallyRegister, type FamilyObservation } from './documentFamily';
import { partyKey, partyKeyCollapsed } from './normalize';
import type { ReconciliationProfile } from './profile';

export type Stage = (label: string) => void;

export type TransactionResult = {
  weighmentId: string; serialNo: number; date: string; vehicle: string; party: string; material: string; materialFamily: string;
  netWeight: number | null; weighBridgeRef: string; category: Category; categoryReason: string;
  gate: Gate | null; gateScore: number; gateEvidence: string[];
  tallySelected: TallyVoucher[]; tallyScore: number; tallyEvidence: string[];
  consolidatedWith: string[];
  confidence: number; band: ActionBand; status: string; exceptionCode: string | null; comments: string;
  aiSource: 'AI' | 'DETERMINISTIC_FALLBACK' | null;
  gateRejectedCount: number; tallyRejectedCount: number;
  gateCandidatesAll: { id: string; gp: string; party: string; material: string; order: string; direction: string; date: string; score: number; selected: boolean }[];
  tallyCandidatesAll: { id: string; vchNo: string; orderRef: string; party: string; sheetRole: string; date: string; score: number; selected: boolean }[];
  weighmentSource: { file: string; sheet: string; row: number };
};

export type EngineResult = {
  reconciliationDate: string;
  transactions: TransactionResult[];
  consolidatedVouchers: ConsolidatedGroup[];
  summary: {
    totalWeighments: number; purchase: number; sales: number; jobWork: number; others: number;
    fullyReconciled: number; aiReconciled: number; partial: number; exceptions: number; review: number;
    reconciliationPercent: number; automationPercent: number; averageConfidence: number;
  };
  sourceStats: { weighmentRows: number; gateRows: number; tallyVoucherAppearances: number; uniqueTallyVouchers: number; tallySheets: number };
  warnings: string[];
};

// "Not Found" (spec §34) means genuinely nothing credible exists after full
// search — never "one field is missing." Finding a real reference (even an
// ORDER-stage one, or a Gate record without a booking voucher yet) is
// evidence of an in-progress transaction chain, not an absence, so it must
// never collapse to Not Found just because a numeric confidence band was
// computed as REVIEW rather than SECOND_PASS — those are two different axes
// (dominant-candidate ambiguity vs. how complete the evidence chain is).
function statusFor(band: ActionBand, hasGate: boolean, bookingFound: boolean, anyTallyFound: boolean, category: Category): { status: string; exceptionCode: string | null } {
  if (category === 'Others') return { status: 'Others', exceptionCode: null };
  if (band === 'AUTO_RECONCILE' && bookingFound) return { status: 'Reconciled', exceptionCode: null };
  if (band === 'AUTO_RECONCILE_AI_EXPLAIN' && bookingFound) return { status: 'Reconciled (AI)', exceptionCode: null };
  if (!hasGate && !anyTallyFound) return { status: 'Not Found', exceptionCode: 'GATE_RECORD_MISSING' };
  if (hasGate && !anyTallyFound) return { status: 'Not Found', exceptionCode: 'TALLY_BOOKING_MISSING' };
  if (band === 'REVIEW') return { status: 'Review', exceptionCode: 'AMBIGUOUS_MULTIPLE_TRIPS' };
  return { status: 'Partial', exceptionCode: bookingFound ? 'AMBIGUOUS_MULTIPLE_TRIPS' : 'TALLY_BOOKING_MISSING' };
}

export async function runReconciliation(
  input: { weighmentBook: XLSX.WorkBook; weighmentFile: string; gateInBooks: { book: XLSX.WorkBook; file: string }[]; gateOutBooks: { book: XLSX.WorkBook; file: string }[]; tallyBook: XLSX.WorkBook; tallyFile: string; reconciliationDate?: string },
  profile: ReconciliationProfile,
  onStage: Stage = () => {},
): Promise<{ result: EngineResult; familyObservations: FamilyObservation[] }> {
  onStage('Validating file formats...');
  onStage('Reading weighment data...');
  const weigh = parseWeighmentUpload(input.weighmentBook, input.weighmentFile, input.reconciliationDate || '');

  onStage('Reading Gate In...');
  const gatesIn = input.gateInBooks.flatMap(({ book, file }) => parseGateUpload(book, file, 'IN'));
  onStage('Reading Gate Out...');
  const gatesOut = input.gateOutBooks.flatMap(({ book, file }) => parseGateUpload(book, file, 'OUT'));
  const gates: Gate[] = [...gatesIn, ...gatesOut];

  onStage('Parsing Tally...');
  const tally = parseTallyUpload(input.tallyBook, input.tallyFile);

  onStage('Normalizing records...');
  const gateIndex = buildGateIndex(gates);
  const day = weigh.date;

  const familyObservations: FamilyObservation[] = [
    ...gatesIn.flatMap(g => observeFromGateIn(g.order, day)),
    ...gatesOut.flatMap(g => observeFromGateOut(g.order, day)),
    ...tally.vouchers.filter(v => v.sheetRole === 'purchase_register' || v.sheetRole === 'sales_register').flatMap(v => {
      const vchPrefix = /^([A-Za-z][A-Za-z\-]*)/.exec(v.vchNo)?.[1]?.toUpperCase() || '';
      const orderPrefix = /^([A-Za-z][A-Za-z\-]*)/.exec(v.orderRef)?.[1]?.toUpperCase() || '';
      return observeFromTallyRegister(vchPrefix, orderPrefix, v.sheetRole as 'purchase_register' | 'sales_register', day);
    }),
  ];

  onStage('Classifying transactions...');
  // Bucket by the first characters of the COLLAPSED (no-space) party key,
  // not a naive whitespace-split first token — "M.B.S.Traders" and "MBS
  // Traders" collapse to prefixes of the same string but split into
  // completely different first tokens ("M" vs "MBS"), which silently
  // starved candidate generation for exactly the kind of party-formatting
  // difference this engine is supposed to tolerate (spec §13).
  const partyBucketKey = (p: string) => partyKeyCollapsed(p).slice(0, 3);
  const partyTokenIndex = new Map<string, TallyVoucher[]>();
  for (const v of tally.vouchers) {
    const key = partyBucketKey(v.party);
    if (!key) continue;
    (partyTokenIndex.get(key) || partyTokenIndex.set(key, []).get(key)!).push(v);
  }
  function tallyCandidatePool(w: Weighment, gate: Gate | null): TallyVoucher[] {
    const orderRefs = [gate?.order, w.ref].filter(Boolean) as string[];
    const byOrder = orderRefs.length ? tally.vouchers.filter(v => orderRefs.some(o => v.orderRef && v.orderRef.toUpperCase().includes(o.toUpperCase().split('/')[0]))) : [];
    // Bucket by BOTH the weighment's own recorded party and the gate's —
    // they can genuinely differ (a Gate Out "Customer Name" sometimes
    // carries a related/handling unit's own name as a data-entry
    // convention, e.g. real Soyabari rows showing "SVMA Soya Foods" on the
    // gate while the weighment itself correctly names the real buyer).
    // Preferring gate.party alone silently excluded the real Tally
    // booking's own bucket from ever being searched — confirmed directly:
    // a genuine same-day "Sales-Soya Bari- ERP" voucher for the
    // weighment's true customer never even reached scoring.
    const keys = new Set([partyBucketKey(w.party), partyBucketKey(gate?.party || '')].filter(Boolean));
    const byParty = [...keys].flatMap(key => partyTokenIndex.get(key) || []);
    if (byOrder.length || byParty.length) return Array.from(new Set([...byOrder, ...byParty]));
    return tally.vouchers; // last resort: full scan, still bounded by realistic voucher counts
  }

  onStage('Matching Gate records...');
  const states: WeighmentMatchState[] = [];
  const perWeighment = new Map<string, { w: Weighment; category: Category; categoryReason: string; materialFamily: string; rankedGates: { candidate: GateCandidate; score: number; evidence: string[] }[]; allGateCandidates: GateCandidate[] }>();

  const UNRESOLVED_REASON = 'No Gate In/Out record could be linked to this weighment, and the material is not a recognized commercial family.';
  weigh.rows.forEach((w, idx) => {
    const rawCandidates = generateGateCandidates(w, gateIndex, profile.thresholds);
    const narrowed = narrowCandidates(rawCandidates, profile.thresholds);
    const { category, reason, materialFamily } = classifyWeighment(w, narrowed, profile);
    const rankedGates = rawCandidates
      .map(c => ({ candidate: c, ...scoreGateCandidate(w, c, profile.thresholds.weights) }))
      .sort((a, b) => b.score - a.score);
    perWeighment.set(w.id, { w, category, categoryReason: reason, materialFamily, rankedGates, allGateCandidates: rawCandidates });
  });

  // "A purchase that fails matching is still Purchase" (spec §12) — when a
  // weighment has NO Gate evidence at all and its material isn't a
  // configured non-commercial family, look at how the SAME material family
  // resolved elsewhere in this run (via real Gate evidence). A material
  // that is unanimously Purchase (or Sales) elsewhere this run is still
  // that direction here; only true directional silence stays Others.
  const directionCounts = new Map<string, { Purchase: number; Sales: number }>();
  for (const rec of perWeighment.values()) {
    if (rec.category !== 'Purchase' && rec.category !== 'Sales') continue;
    const counts = directionCounts.get(rec.materialFamily) || { Purchase: 0, Sales: 0 };
    counts[rec.category]++;
    directionCounts.set(rec.materialFamily, counts);
  }
  for (const rec of perWeighment.values()) {
    if (rec.category !== 'Others' || rec.categoryReason !== UNRESOLVED_REASON) continue;
    const counts = directionCounts.get(rec.materialFamily);
    if (!counts) continue;
    if (counts.Purchase > 0 && counts.Sales === 0) { rec.category = 'Purchase'; rec.categoryReason = `No Gate record for this specific weighment, but "${rec.materialFamily}" is a Purchase material in every other occurrence in this upload.`; }
    else if (counts.Sales > 0 && counts.Purchase === 0) { rec.category = 'Sales'; rec.categoryReason = `No Gate record for this specific weighment, but "${rec.materialFamily}" is a Sales material in every other occurrence in this upload.`; }
  }

  onStage('Matching accounting vouchers...');
  for (const w of weigh.rows) {
    const rec = perWeighment.get(w.id)!;
    const topGate = rec.rankedGates[0]?.candidate.gate || null;
    const orderRefs = [topGate?.order, ...rec.rankedGates.slice(0, 3).map(g => g.candidate.gate.order)].filter(Boolean) as string[];
    const pool = tallyCandidatePool(w, topGate);
    // A genuine booking voucher always outranks an order-stage-only or
    // settlement-only one, even if the latter's raw score is close — the
    // spec is explicit that finding the order is not finding the booking,
    // and a Payment/Receipt line is never proof of booking (§20).
    const stageRank = { BOOKING: 3, ORDER: 2, SUPPORTING: 1, UNKNOWN: 0 } as const;
    const rankedTally = pool
      .map(v => ({ voucher: v, ...scoreTallyCandidate(rec.category, w, topGate, orderRefs, v, profile) }))
      .filter(r => !r.disqualified && r.score > 0)
      .sort((a, b) => stageRank[b.stage] - stageRank[a.stage] || b.score - a.score);
    states.push({
      weighmentId: w.id, party: w.party, materialFamily: rec.materialFamily, netWeight: w.weight, date: w.date,
      rankedGates: rec.rankedGates.map(g => ({ gate: g.candidate.gate, score: g.score, evidence: g.evidence })),
      rankedTally: rankedTally.map(t => ({ voucher: t.voucher, score: t.score, evidence: t.evidence })),
      chosenGateIndex: -1, chosenTallyIndices: [], notes: [],
    });
  }

  onStage('Resolving remaining candidates...');
  const { consolidated } = resolveGlobalAssignment(states);

  onStage('Running AI reasoning...');
  const stateById = new Map(states.map(s => [s.weighmentId, s]));
  const secondPassCases: SecondPassCase[] = [];
  const preliminary = new Map<string, { confidence: number; band: ActionBand }>();
  for (const w of weigh.rows) {
    const s = stateById.get(w.id)!;
    const gateScore = s.chosenGateIndex >= 0 ? s.rankedGates[s.chosenGateIndex].score : 0;
    const tallyScore = s.chosenTallyIndices.length ? s.rankedTally[s.chosenTallyIndices[0]].score : 0;
    const rec = perWeighment.get(w.id)!;
    const confidence = rec.category === 'Others' ? 100 : Math.round((gateScore * 0.4 + tallyScore * 0.6));
    const band = bandFor(confidence, profile.thresholds);
    preliminary.set(w.id, { confidence, band });
    if (band === 'SECOND_PASS' && rec.category !== 'Others') {
      secondPassCases.push({
        caseId: w.id,
        weighment: { ref: w.ref, date: w.date, vehicle: w.vehicle, party: w.party, material: w.material, netWeight: w.weight, category: rec.category },
        gateCandidates: s.rankedGates.slice(0, 5).map(g => ({ id: g.gate.id, gp: g.gate.gp, party: g.gate.party, material: g.gate.material, order: g.gate.order, direction: g.gate.direction, date: g.gate.date, deterministicScore: g.score })),
        tallyCandidates: s.rankedTally.slice(0, 5).map(t => ({ id: t.voucher.id, vchNo: t.voucher.vchNo, orderRef: t.voucher.orderRef, party: t.voucher.party, sheetRole: t.voucher.sheetRole, date: t.voucher.date, deterministicScore: t.score })),
        deterministic: { gateId: s.chosenGateIndex >= 0 ? s.rankedGates[s.chosenGateIndex].gate.id : null, tallyId: s.chosenTallyIndices.length ? s.rankedTally[s.chosenTallyIndices[0]].voucher.id : null, confidence },
      });
    }
  }
  const aiDecisions = await resolveSecondPass(secondPassCases);

  onStage('Validating results...');
  const explainCandidates: { id: string; summary: string }[] = [];
  const transactions: TransactionResult[] = weigh.rows.map((w, idx) => {
    const rec = perWeighment.get(w.id)!;
    const s = stateById.get(w.id)!;
    let gate = s.chosenGateIndex >= 0 ? s.rankedGates[s.chosenGateIndex].gate : null;
    let gateScore = s.chosenGateIndex >= 0 ? s.rankedGates[s.chosenGateIndex].score : 0;
    let gateEvidence = s.chosenGateIndex >= 0 ? s.rankedGates[s.chosenGateIndex].evidence : [];
    let tallySelected = s.chosenTallyIndices.length ? [s.rankedTally[s.chosenTallyIndices[0]].voucher] : [];
    let tallyScore = s.chosenTallyIndices.length ? s.rankedTally[s.chosenTallyIndices[0]].score : 0;
    let tallyEvidence = s.chosenTallyIndices.length ? s.rankedTally[s.chosenTallyIndices[0]].evidence : [];
    let { confidence, band } = preliminary.get(w.id)!;
    let aiSource: TransactionResult['aiSource'] = null;

    if (band === 'SECOND_PASS') {
      const decision = aiDecisions.get(w.id);
      if (decision) {
        aiSource = decision.source;
        if (decision.selectedGateCandidateId) { const found = s.rankedGates.find(g => g.gate.id === decision.selectedGateCandidateId); if (found) { gate = found.gate; gateScore = found.score; gateEvidence = found.evidence; } }
        if (decision.selectedTallyCandidateId) { const found = s.rankedTally.find(t => t.voucher.id === decision.selectedTallyCandidateId); if (found) { tallySelected = [found.voucher]; tallyScore = found.score; tallyEvidence = found.evidence; } }
        if (decision.source === 'AI') {
          confidence = decision.confidence;
          band = bandFor(confidence, profile.thresholds);
          tallyEvidence = [...tallyEvidence, ...decision.evidence];
        }
      }
    }

    const dominant = isDominant(s.rankedGates.slice(0, 2), profile.thresholds.dominantMargin) && isDominant(s.rankedTally.slice(0, 2), profile.thresholds.dominantMargin);
    if (!dominant && band !== 'REVIEW' && rec.category !== 'Others' && aiSource !== 'AI') band = s.rankedGates.length > 1 || s.rankedTally.length > 1 ? (confidence >= profile.thresholds.secondPassMin ? band : 'REVIEW') : band;

    const consolidatedWith = tallySelected.length ? (consolidated.find(g => g.voucherId === tallySelected[0].id)?.weighmentIds.filter(id => id !== w.id) || []) : [];
    // Finding only an ORDER-stage (or supporting/settlement-only) Tally
    // record is real evidence a document chain exists, but it is never
    // "the qualifying Purchase/Sales voucher" — never call this Reconciled.
    const bookingFound = tallySelected.length > 0 && tallySelected[0].stage === 'BOOKING';
    const { status, exceptionCode } = statusFor(band, !!gate, bookingFound, tallySelected.length > 0, rec.category);

    let comments: string;
    if (rec.category === 'Others') comments = rec.categoryReason;
    else if (status === 'Reconciled') comments = `Auto-reconciled using Gate ${gate?.direction === 'IN' ? 'In' : 'Out'}, ${gateEvidence.join(', ')}, and Tally ${tallySelected[0]?.vchType || (tallySelected[0]?.sheetRole === 'purchase_register' ? 'Purchase' : 'Sales')} voucher ${tallySelected[0]?.vchNo}.`;
    else if (status === 'Reconciled (AI)') comments = `${gateEvidence.concat(tallyEvidence).join('; ')}.`;
    else if (exceptionCode === 'TALLY_BOOKING_MISSING') comments = `Physical movement and Gate record found (${gate?.gp}), but no qualifying Purchase/Sales voucher exists in the uploaded Tally file after full search.`;
    else if (exceptionCode === 'GATE_RECORD_MISSING') comments = 'No matching Gate In/Out record could be found for this vehicle/date/material after full search.';
    else if (exceptionCode === 'AMBIGUOUS_MULTIPLE_TRIPS') comments = 'Multiple candidate trips/vouchers remain close in evidence after AI reasoning; manual review recommended.';
    else comments = 'Reconciliation evidence is inconclusive after full deterministic and AI search.';

    if (status === 'Reconciled (AI)') explainCandidates.push({ id: w.id, summary: comments });

    return {
      weighmentId: w.id, serialNo: idx + 1, date: w.date, vehicle: w.vehicle, party: w.party, material: w.material, materialFamily: rec.materialFamily,
      netWeight: w.weight, weighBridgeRef: w.ref, category: rec.category, categoryReason: rec.categoryReason,
      gate, gateScore, gateEvidence, tallySelected, tallyScore, tallyEvidence, consolidatedWith,
      confidence, band, status, exceptionCode, comments, aiSource,
      gateRejectedCount: Math.max(0, s.rankedGates.length - (gate ? 1 : 0)), tallyRejectedCount: Math.max(0, s.rankedTally.length - (tallySelected.length ? 1 : 0)),
      // Capped like tallyCandidatesAll below — a busy vehicle can rack up
      // dozens of Gate rows in a day, and shipping every one of them to the
      // client on every row bloated the reconciliation payload noticeably
      // (this is what was behind the reported tab-switching slowness).
      // rankedGates is sorted by score descending, so the selected
      // candidate is essentially always inside the first 10 already.
      gateCandidatesAll: s.rankedGates.slice(0, 10).map(g => ({ id: g.gate.id, gp: g.gate.gp, party: g.gate.party, material: g.gate.material, order: g.gate.order, direction: g.gate.direction, date: g.gate.date, score: Math.round(g.score), selected: g.gate.id === gate?.id })),
      tallyCandidatesAll: s.rankedTally.slice(0, 10).map(t => ({ id: t.voucher.id, vchNo: t.voucher.vchNo, orderRef: t.voucher.orderRef, party: t.voucher.party, sheetRole: t.voucher.sheetRole, date: t.voucher.date, score: Math.round(t.score), selected: tallySelected.some(sel => sel.id === t.voucher.id) })),
      weighmentSource: w.source,
    };
  });

  const explained = await explainAutoReconciled(explainCandidates);
  for (const t of transactions) if (explained.has(t.weighmentId)) t.comments = explained.get(t.weighmentId)!;

  onStage('Generating reports...');
  // Exempt materials (spec-confirmed: their booking lives in a Tally
  // system this upload never contains) still appear as real Purchase/Sales
  // movements with their genuine status everywhere in the output — only
  // excluded from the reconciliation %/automation % denominator, the same
  // way Others already is, so a structurally-unmatchable material doesn't
  // drag those numbers down for something this upload was never going to
  // resolve.
  const applicable = transactions.filter(t => t.category !== 'Others' && !profile.seedTaxonomy.accuracyExemptMaterialFamilies.includes(t.materialFamily));
  const fullyReconciled = transactions.filter(t => t.status === 'Reconciled').length;
  const aiReconciled = transactions.filter(t => t.status === 'Reconciled (AI)').length;
  const partial = transactions.filter(t => t.status === 'Partial').length;
  const reviewCount = transactions.filter(t => t.status === 'Review').length;
  const exceptionsCount = transactions.filter(t => t.status === 'Not Found').length;
  const applicableResolved = applicable.filter(t => t.status === 'Reconciled' || t.status === 'Reconciled (AI)').length;

  const warnings: string[] = [];
  if (!tally.vouchers.length) warnings.push('The Tally file has recognized headers but no voucher rows.');
  if (gates.some(g => !g.date)) warnings.push('Some Gate dates are missing or invalid; those rows remain candidates only.');

  const result: EngineResult = {
    reconciliationDate: day,
    transactions,
    consolidatedVouchers: consolidated,
    summary: {
      totalWeighments: transactions.length,
      purchase: transactions.filter(t => t.category === 'Purchase').length,
      sales: transactions.filter(t => t.category === 'Sales').length,
      jobWork: transactions.filter(t => t.category === 'Job Work').length,
      others: transactions.filter(t => t.category === 'Others').length,
      fullyReconciled, aiReconciled, partial, exceptions: exceptionsCount, review: reviewCount,
      reconciliationPercent: applicable.length ? Math.round((applicableResolved / applicable.length) * 1000) / 10 : 100,
      automationPercent: applicable.length ? Math.round((applicableResolved / applicable.length) * 1000) / 10 : 100,
      averageConfidence: transactions.length ? Math.round((transactions.reduce((n, t) => n + t.confidence, 0) / transactions.length) * 10) / 10 : 0,
    },
    sourceStats: { weighmentRows: weigh.rows.length, gateRows: gates.length, tallyVoucherAppearances: tally.rawVoucherCount, uniqueTallyVouchers: tally.vouchers.length, tallySheets: tally.recognizedSheets },
    warnings,
  };
  return { result, familyObservations };
}
