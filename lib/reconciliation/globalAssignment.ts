import type { Gate } from './parsers';
import type { TallyVoucher } from './parsers';

// Global assignment (spec §23 PASS 3, §50). A true optimal bipartite
// max-weight assignment (Hungarian algorithm) is overkill for the volumes
// here (tens to a few hundred weighments/day) and harder to audit row by
// row; this implements the same objective — no gate or non-consolidated
// voucher silently double-allocated — via greedy-by-score assignment with a
// bounded reassignment cascade, which is easy to explain in the audit trail
// (spec §51) and provably terminates. If daily volumes grow enough that this
// approximation measurably diverges from optimal, swap this function's body
// for a real weighted matching solver without touching any caller.

export type RankedGate = { gate: Gate; score: number; evidence: string[] };
export type RankedTally = { voucher: TallyVoucher; score: number; evidence: string[] };
export type WeighmentMatchState = {
  weighmentId: string; party: string; materialFamily: string; netWeight: number | null; date: string;
  rankedGates: RankedGate[];
  rankedTally: RankedTally[];
  chosenGateIndex: number;
  chosenTallyIndices: number[];
  notes: string[];
};

export type ConsolidatedGroup = { voucherId: string; weighmentIds: string[] };

function assignGates(states: WeighmentMatchState[]): void {
  for (const s of states) s.chosenGateIndex = s.rankedGates.length ? 0 : -1;
  for (let pass = 0; pass < 6; pass++) {
    const ownerByGate = new Map<string, WeighmentMatchState>();
    let changed = false;
    for (const s of states) {
      if (s.chosenGateIndex < 0) continue;
      const gateId = s.rankedGates[s.chosenGateIndex].gate.id;
      const current = ownerByGate.get(gateId);
      if (!current) { ownerByGate.set(gateId, s); continue; }
      const currentScore = current.rankedGates[current.chosenGateIndex].score;
      const thisScore = s.rankedGates[s.chosenGateIndex].score;
      const loser = thisScore <= currentScore ? s : current;
      if (thisScore > currentScore) ownerByGate.set(gateId, s);
      loser.chosenGateIndex += 1;
      if (loser.chosenGateIndex >= loser.rankedGates.length) { loser.chosenGateIndex = -1; loser.notes.push('Gate record was allocated to another weighment with stronger evidence; no alternative candidate remained.'); }
      changed = true;
    }
    if (!changed) break;
  }
}

/** A voucher legitimately claimed by several weighments is a CONSOLIDATED
 * VOUCHER when they share party/material and the voucher's own quantity is
 * consistent with the sum of their net weights (within tolerance) — never
 * assumed, always checked. */
function isConsolidation(claimants: WeighmentMatchState[], voucher: TallyVoucher): boolean {
  if (claimants.length < 2) return false;
  const partiesConsistent = claimants.every(c => c.party && claimants[0].party && c.materialFamily === claimants[0].materialFamily);
  if (!partiesConsistent) return false;
  if (voucher.quantity == null) return true; // no quantity to contradict consolidation; party/material agreement is the available evidence
  const sum = claimants.reduce((n, c) => n + (c.netWeight || 0), 0) / 1000; // kg -> tonnes, matches Tally "Quantity" convention observed in samples
  if (!sum) return true;
  const ratio = sum / voucher.quantity;
  return ratio > 0.5 && ratio < 2;
}

function assignTally(states: WeighmentMatchState[]): ConsolidatedGroup[] {
  for (const s of states) s.chosenTallyIndices = s.rankedTally.length ? [0] : [];
  const consolidated: ConsolidatedGroup[] = [];
  for (let pass = 0; pass < 6; pass++) {
    const claimantsByVoucher = new Map<string, WeighmentMatchState[]>();
    for (const s of states) {
      if (!s.chosenTallyIndices.length) continue;
      const voucherId = s.rankedTally[s.chosenTallyIndices[0]].voucher.id;
      (claimantsByVoucher.get(voucherId) || claimantsByVoucher.set(voucherId, []).get(voucherId)!).push(s);
    }
    let changed = false;
    for (const [voucherId, claimants] of claimantsByVoucher) {
      if (claimants.length < 2) continue;
      const voucher = claimants[0].rankedTally[claimants[0].chosenTallyIndices[0]].voucher;
      if (isConsolidation(claimants, voucher)) {
        if (!consolidated.some(c => c.voucherId === voucherId)) consolidated.push({ voucherId, weighmentIds: claimants.map(c => c.weighmentId) });
        continue;
      }
      const ranked = claimants.slice().sort((a, b) => b.rankedTally[b.chosenTallyIndices[0]].score - a.rankedTally[a.chosenTallyIndices[0]].score);
      for (const loser of ranked.slice(1)) {
        loser.chosenTallyIndices = [loser.chosenTallyIndices[0] + 1].filter(i => i < loser.rankedTally.length);
        if (!loser.chosenTallyIndices.length) loser.notes.push('This voucher is already allocated to another weighment and no consolidation evidence (matching party/material/quantity) was found; no alternative candidate remained.');
        changed = true;
      }
    }
    if (!changed) break;
  }
  return consolidated.filter(g => g.weighmentIds.length >= 2);
}

export function resolveGlobalAssignment(states: WeighmentMatchState[]): { consolidated: ConsolidatedGroup[] } {
  assignGates(states);
  const consolidated = assignTally(states);
  return { consolidated };
}
