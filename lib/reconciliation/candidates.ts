import type { Gate, Weighment } from './parsers';
import { normalizeVehicle, nameSimilarity, materialSimilarity, daysBetween } from './normalize';
import type { Thresholds } from './profile';

// Candidate generation via INDEXES (vehicle/date/party/material), never a
// blind O(N²) row-by-row scan — see spec §17. The same vehicle can appear
// several times a day, so vehicle alone is never sufficient; every
// downstream candidate carries the full context needed to score it.

export type GateCandidate = { gate: Gate; vehicleMatch: boolean; withinWindow: boolean; materialScore: number; partyScore: number; sameDay: boolean };

export function buildGateIndex(gates: Gate[]): Map<string, Gate[]> {
  const index = new Map<string, Gate[]>();
  for (const g of gates) {
    const key = normalizeVehicle(g.vehicle);
    if (!key) continue;
    (index.get(key) || index.set(key, []).get(key)!).push(g);
  }
  return index;
}

export function generateGateCandidates(w: Weighment, gateIndex: Map<string, Gate[]>, thresholds: Thresholds): GateCandidate[] {
  const vehicleKey = normalizeVehicle(w.vehicle);
  const sameVehicle = vehicleKey ? gateIndex.get(vehicleKey) || [] : [];
  return sameVehicle.map(gate => {
    const dist = daysBetween(w.date, gate.date);
    return {
      gate,
      vehicleMatch: true,
      withinWindow: gate.date === '' || (dist ?? Infinity) <= thresholds.gateVehicleWindowDays,
      materialScore: materialSimilarity(w.material, gate.material),
      partyScore: nameSimilarity(w.party, gate.party),
      sameDay: gate.date === w.date,
    };
  });
}

/** Narrow the raw candidate list to the plausible set for this weighment,
 * preferring (in order): same-day + material-consistent + party-consistent,
 * falling back to material-only, then to any vehicle match in-window. This
 * mirrors what the reviewed sample data actually supports — see
 * lib/reconciliation/scoring.ts for the confidence number attached to
 * whichever candidates survive. */
export function narrowCandidates(all: GateCandidate[], thresholds: Thresholds): GateCandidate[] {
  const inWindow = all.filter(c => c.withinWindow);
  const materialOk = inWindow.filter(c => c.materialScore >= 0.6);
  const partyOk = materialOk.filter(c => c.partyScore >= thresholds.gateNameThreshold);
  let selected = partyOk.length ? partyOk : materialOk.length ? materialOk : inWindow;
  const sameDay = selected.filter(c => c.sameDay);
  if (sameDay.length) selected = sameDay;
  return selected;
}
