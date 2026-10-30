import type { GateCandidate } from './candidates';
import type { TallyVoucher, Weighment, Gate } from './parsers';
import type { ReconciliationProfile, ScoringWeights } from './profile';
import { nameSimilarity, materialSimilarity, sequenceRatio, daysBetween } from './normalize';
import { referenceEquals, sameFamily } from './reference';
import { lookupFamily } from './documentFamily';
import type { Category } from './classification';

// Whole-word commodity consistency check — deliberately NOT the generic
// character-sequence materialSimilarity above. Verified directly: on the
// real data, "SOYABARI" scores a HIGHER raw sequence-similarity against
// "Sales-Soya Bean ERP" (0.58) than several genuine matches like DORB
// against its own real register (0.36–0.41) — the shared "SOYA" prefix
// between two DIFFERENT products (bari vs bean) fools plain sequence
// similarity, so no single threshold on it can separate the two. This
// instead requires every significant commodity WORD named by the register
// (e.g. "SOYA" and "BEAN") to individually correspond to some word in the
// weighment's own material text (exact, substring, or a close per-word
// spelling match like "Kernal"/"Kernel") — "SOYA" alone matching isn't
// enough when "BEAN" has no counterpart at all in "SOYABARI".
// "Other"/"Others" is itself a genuine catch-all bucket in the real Tally
// data (e.g. "Purchase - Other ERP" carries firewood, timber and similar
// misc materials together, not one commodity each) — treating it as a real
// commodity word wrongly blocked genuine firewood matches, since firewood
// has no dedicated register of its own. Generic-bucket vouchers correctly
// fall through to "nothing to check against" (see commodityConsistent)
// and are judged on their other evidence (party, date, invoice) instead.
const REGISTER_SCAFFOLD_WORDS = new Set(['SALES', 'PURCHASE', 'ERP', 'REGISTER', 'DAY', 'BOOK', 'THE', 'AND', 'OF', 'CBS', 'OTHER', 'OTHERS']);
function significantWords(raw: string): string[] {
  return String(raw || '').toUpperCase().split(/[^A-Z0-9]+/).filter(w => w.length >= 3 && !REGISTER_SCAFFOLD_WORDS.has(w));
}
function wordsRelated(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  return sequenceRatio(a, b) >= 0.7;
}
/** true = consistent or nothing to check against (no commodity words in
 * either the register label or the voucher's own type text — a plain
 * "Purchase"/"Sales" entry carries no commodity signal to gate on). */
function commodityConsistent(materialRef: string, registerText: string): boolean {
  const registerWords = significantWords(registerText);
  if (!registerWords.length) return true;
  const materialWords = significantWords(materialRef);
  if (!materialWords.length) return true;
  return registerWords.every(rw => materialWords.some(mw => wordsRelated(rw, mw)));
}

// Transparent, additive evidence scoring (spec §26) — every point is
// traceable to a named piece of evidence; nothing is buried inside an LLM
// call. Scores are clamped to [0,100].

export type GateScoreResult = { score: number; evidence: string[] };
export function scoreGateCandidate(w: Weighment, c: GateCandidate, weights: ScoringWeights): GateScoreResult {
  const evidence: string[] = [];
  let score = 0;
  if (c.vehicleMatch) { score += weights.gateVehicleExact; evidence.push('vehicle matched'); }
  if (c.sameDay) { score += weights.gateSameDay; evidence.push('same-day gate record'); }
  score += weights.gateMaterialMatch * c.materialScore;
  if (c.materialScore >= 0.85) evidence.push('material matched');
  score += weights.gatePartyMatch * c.partyScore;
  if (c.partyScore >= 0.84) evidence.push('party matched');
  if (c.gate.order) { score += weights.gateOrderPresent; evidence.push('order/reference present on gate record'); }
  return { score: Math.max(0, Math.min(100, score)), evidence };
}

export type TallyScoreResult = { score: number; evidence: string[]; disqualified: boolean; stage: 'ORDER' | 'BOOKING' | 'SUPPORTING' | 'UNKNOWN' };
export function scoreTallyCandidate(
  category: Category,
  w: Weighment,
  gate: Gate | null,
  orderRefs: string[],
  v: TallyVoucher,
  profile: ReconciliationProfile,
): TallyScoreResult {
  const weights = profile.thresholds.weights;
  const evidence: string[] = [];
  let score = 0;
  const stage = v.stage;

  const expectedDirection: 'PURCHASE' | 'SALES' | null = category === 'Purchase' ? 'PURCHASE' : category === 'Sales' ? 'SALES' : null;
  const registerDirection = v.sheetRole === 'purchase_register' ? 'PURCHASE' : v.sheetRole === 'sales_register' ? 'SALES' : null;
  if (expectedDirection && registerDirection && expectedDirection !== registerDirection) {
    return { score: 0, evidence: ['transaction direction conflicts with this voucher\'s register'], disqualified: true, stage: 'UNKNOWN' };
  }
  // A Payment/Receipt/Journal/Contra entry is settlement, never a booking
  // (spec §20) — matching one by party name alone previously surfaced as a
  // real-looking "Tally Purchase Ref", which is exactly the false
  // impression the spec warns against. It can never be the SELECTED match;
  // a transaction with no candidate but settlement rows must fall through
  // to Not Found, not present a payment voucher as if it were the booking.
  if (stage === 'SUPPORTING') return { score: 0, evidence: ['only a Payment/Receipt/Journal entry — settlement only, not eligible as a booking match'], disqualified: true, stage };

  // Score against BOTH the weighment's own party and the gate's, taking
  // whichever is stronger — they can legitimately differ (see
  // engine.ts::tallyCandidatePool), and picking one over the other in
  // advance risks discarding whichever one actually matches the voucher.
  const weighmentPartyScore = nameSimilarity(w.party, v.party);
  const gatePartyScore = gate?.party ? nameSimilarity(gate.party, v.party) : 0;
  const partyScore = Math.max(weighmentPartyScore, gatePartyScore);

  // A reference match only counts as full "the booking exists" evidence
  // when it lands on a BOOKING-stage voucher. The same exact reference on
  // an ORDER-stage-only voucher (e.g. a "Purchase Order" typed row sitting
  // in the Day Book) is real, but weaker, evidence — it proves an order was
  // placed, not that the accounting booking exists yet (spec's "Purchase
  // Order found but final Purchase voucher missing" case).
  const orderMatch = orderRefs.some(o => referenceEquals(o, v.orderRef) || referenceEquals(o, v.vchNo));
  // A shared reference FAMILY with a different serial (e.g. gate's
  // OIL-SO/00572 vs this voucher's OIL-SO/00571) is real evidence only when
  // something else corroborates it — a family alone just means "some other
  // order in the same numbering sequence," which is true of every other
  // customer's order that day too. Confirmed directly: this previously
  // matched a weighment to a completely unrelated customer's voucher
  // ("KCC Oil Mills" → "Sri Sastha Oil Store") purely because both orders
  // happened to be sequential OIL-SO numbers, with zero party similarity
  // (0.29) — well below even a loose corroboration bar. The corroboration
  // threshold here (0.5) is deliberately looser than the full party-match
  // threshold below, since it only has to rule out "obviously someone
  // else," not confirm identity outright — reference family + order/date
  // context still does the rest.
  const familyMatchRaw = orderRefs.some(o => sameFamily(o, v.orderRef) || sameFamily(o, v.vchNo));
  const familyMatch = !orderMatch && familyMatchRaw && partyScore >= 0.5;
  const stageMultiplier = stage === 'BOOKING' ? 1 : stage === 'ORDER' ? 0.35 : 0.6;
  if (orderMatch) { score += weights.tallyOrderReferenceMatch * stageMultiplier; evidence.push(stage === 'BOOKING' ? 'exact PO/SO/reference linked to final voucher' : 'exact PO/SO/reference found, but only as an order-stage record — final booking voucher not yet confirmed'); }
  else if (familyMatch) { score += weights.tallyOrderReferenceMatch * 0.6 * stageMultiplier; evidence.push('same document family as the gate order reference (different serial — possible consolidated voucher), corroborated by party name similarity'); }
  else if (familyMatchRaw) { evidence.push('same document family as the gate order reference, but the party name is not a plausible match — not treated as evidence (likely a different customer\'s order in the same numbering sequence)'); }

  if (gate?.invoice && v.supplierInvoice && gate.invoice.trim().toUpperCase() === v.supplierInvoice.trim().toUpperCase()) { score += weights.tallyInvoiceMatch; evidence.push('supplier invoice number matches'); }

  if (partyScore >= profile.thresholds.tallyNameThreshold) { score += weights.tallyPartyMatch * partyScore; evidence.push(`party name matches (${gatePartyScore > weighmentPartyScore ? 'gate' : 'weighment'} party)`); }

  // A commodity-specific booking (Sales-Soya Bean, Purchase-Bran, etc. —
  // whether in a dedicated register sheet or typed as such inside the Day
  // Book itself) is its own separate Tally structure per material — a
  // party-name match alone must never cross into a DIFFERENT commodity
  // (e.g. a Soyabari weighment matching a Soya Bean sales voucher just
  // because the same customer also buys Soya Bean). Without an explicit
  // reference tie, that mismatch disqualifies the candidate outright
  // rather than forcing a wrong match — leaving it correctly blank/Not
  // Found is what the register-based Tally structure actually calls for.
  // Prefers the weighment's OWN material text over the gate's (which can
  // legitimately list several size/grade variants joined together).
  const materialRef = w.material || gate?.material || '';
  const registerText = `${v.registerLabel} ${v.vchType}`;
  const materialScore = materialRef ? materialSimilarity(materialRef, v.registerLabel || v.sheet) : 0;
  // Applies to ORDER and BOOKING stage alike — a Sales-Order-typed voucher
  // for one commodity (e.g. Copra) is just as wrong a match for a
  // different commodity's weighment (e.g. Soyabari) as a booking voucher
  // would be, and by construction SUPPORTING is already excluded above.
  if ((stage === 'BOOKING' || stage === 'ORDER') && materialRef && !orderMatch && !familyMatch && !commodityConsistent(materialRef, registerText)) {
    return { score: 0, evidence: [`material "${materialRef}" does not match this voucher's commodity ("${v.registerLabel}"${v.vchType ? ` / ${v.vchType}` : ''}) — different Tally structure, left unmatched rather than forced`], disqualified: true, stage };
  }
  if (materialScore >= 0.6) evidence.push('material family consistent with register');

  if (stage === 'BOOKING') { score += weights.tallyBookingStage; evidence.push('voucher found in a Purchase/Sales booking register or booking-typed voucher, not a settlement-only entry'); }

  const family = lookupFamily(profile.documentFamilies, v.orderRef || v.vchNo);
  if (family && expectedDirection && family.direction !== expectedDirection && family.direction !== 'UNKNOWN' && family.confidence > 0.7) {
    score += weights.tallyDirectionMismatchPenalty; evidence.push(`learned document family "${family.prefix}" points to ${family.direction}, conflicting with this transaction's ${expectedDirection}`);
  }

  const dist = daysBetween(w.date, v.date);
  if (dist != null) {
    const proximity = Math.max(0, 1 - dist / 5);
    if (proximity > 0) score += weights.tallyDateProximityBonus * proximity;
    if (dist > 5) { score += weights.tallyDateFarPenalty; evidence.push(`voucher date is ${Math.round(dist)} day(s) from the weighment date`); }
  }

  if (!orderMatch && !familyMatch && partyScore < profile.thresholds.tallyNameThreshold) return { score: 0, evidence: ['no reference or party evidence'], disqualified: true, stage };

  return { score: Math.max(0, Math.min(100, score)), evidence, disqualified: false, stage };
}

export type ActionBand = 'AUTO_RECONCILE' | 'AUTO_RECONCILE_AI_EXPLAIN' | 'SECOND_PASS' | 'REVIEW';
export function bandFor(confidence: number, t: ReconciliationProfile['thresholds']): ActionBand {
  if (confidence >= t.autoReconcileMin) return 'AUTO_RECONCILE';
  if (confidence >= t.aiExplainMin) return 'AUTO_RECONCILE_AI_EXPLAIN';
  if (confidence >= t.secondPassMin) return 'SECOND_PASS';
  return 'REVIEW';
}

/** Dominant-candidate rule (spec §25): if the top candidate clearly beats
 * the runner-up, select it outright rather than deferring to Review just
 * because more than one candidate technically exists. */
export function isDominant(sorted: { score: number }[], dominantMargin: number): boolean {
  if (sorted.length <= 1) return true;
  return sorted[0].score - sorted[1].score >= dominantMargin;
}
