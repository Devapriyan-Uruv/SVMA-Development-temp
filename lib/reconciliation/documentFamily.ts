import { parseReference } from './reference';
import type { DocumentFamily } from './profile';

// Document-family DISCOVERY: infer what a reference prefix means from WHERE
// it was observed this run, then reconcile that with what's already
// persisted (profile.documentFamilies) from prior days. Nothing here
// hardcodes a specific prefix like "RB-PO" — every prefix is discovered from
// context and only gains confidence by repeated cross-day observation
// (see profile.upsertDocumentFamilyObservations).

export type FamilyObservation = { prefix: string; direction: 'PURCHASE' | 'SALES' | 'JOB_WORK' | 'UNKNOWN'; stage: 'ORDER' | 'BOOKING' | 'SUPPORTING'; evidence: string; day: string };

export function observeFromGateIn(order: string, day: string): FamilyObservation[] {
  const p = parseReference(order);
  if (!p.prefix) return [];
  return [{ prefix: p.prefix, direction: 'PURCHASE', stage: 'ORDER', evidence: 'Gate In → Purchase Order field', day }];
}
export function observeFromGateOut(order: string, day: string): FamilyObservation[] {
  const p = parseReference(order);
  if (!p.prefix) return [];
  return [{ prefix: p.prefix, direction: 'SALES', stage: 'ORDER', evidence: 'Gate Out → Supplier/Sales Order field', day }];
}
export function observeFromTallyRegister(vchNoPrefix: string, orderRefPrefix: string, sheetRole: 'purchase_register' | 'sales_register', day: string): FamilyObservation[] {
  const direction = sheetRole === 'purchase_register' ? 'PURCHASE' : 'SALES';
  const out: FamilyObservation[] = [];
  if (vchNoPrefix) out.push({ prefix: vchNoPrefix, direction, stage: 'BOOKING', evidence: `Tally ${sheetRole} → Voucher No. family`, day });
  if (orderRefPrefix) out.push({ prefix: orderRefPrefix, direction, stage: 'ORDER', evidence: `Tally ${sheetRole} → Voucher Ref. No. (order) family`, day });
  return out;
}
export function observeFromDayBookSupport(prefix: string, day: string): FamilyObservation[] {
  if (!prefix) return [];
  return [{ prefix, direction: 'UNKNOWN', stage: 'SUPPORTING', evidence: 'Day Book Payment/Receipt/Journal Agst Ref/New Ref', day }];
}

/** Look up what's already known about a reference's family from the
 * persisted profile. Returns null if the prefix has never been observed —
 * callers must not guess in that case, only use it as one signal among
 * several (never party-name alone, never document-family alone). */
export function lookupFamily(families: DocumentFamily[], reference: string): DocumentFamily | null {
  const p = parseReference(reference);
  if (!p.prefix) return null;
  const candidates = families.filter(f => f.prefix === p.prefix);
  if (!candidates.length) return null;
  return candidates.sort((a, b) => b.confidence - a.confidence)[0];
}
