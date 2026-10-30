import type { Weighment } from './parsers';
import type { GateCandidate } from './candidates';
import type { ReconciliationProfile } from './profile';
import { materialTokenKey, materialSimilarity } from './normalize';

export const CATEGORIES = ['Purchase', 'Sales', 'Job Work', 'Others'] as const;
export type Category = typeof CATEGORIES[number];

/** Canonical material family: verified/learned alias first, else the raw
 * token key (never a fixed if/else chain of sample material names). */
export function resolveMaterialFamily(material: string, profile: ReconciliationProfile): string {
  const key = materialTokenKey(material);
  const exact = profile.materialAliases.find(a => a.aliasNormalized === key);
  if (exact) return exact.canonicalFamily;
  const fuzzy = profile.materialAliases.filter(a => materialSimilarity(a.aliasNormalized, key) >= 0.85).sort((a, b) => b.confidence - a.confidence)[0];
  if (fuzzy && fuzzy.confidence >= 0.7) return fuzzy.canonicalFamily;
  return key || 'UNSPECIFIED';
}

function isJobWork(w: Weighment, candidates: GateCandidate[], profile: ReconciliationProfile): boolean {
  const text = `${w.material} ${candidates.map(c => `${c.gate.order} ${c.gate.party}`).join(' ')}`;
  if (/\bJOB\s*[- ]?WORK\b/i.test(text)) return true;
  return profile.jobWorkRules.some(rule => {
    const p = rule.pattern as { partyContains?: string; materialContains?: string; referencePrefix?: string };
    const partyOk = !p.partyContains || candidates.some(c => c.gate.party.toUpperCase().includes(String(p.partyContains).toUpperCase())) || w.party.toUpperCase().includes(String(p.partyContains ?? '').toUpperCase());
    const materialOk = !p.materialContains || w.material.toUpperCase().includes(String(p.materialContains).toUpperCase());
    const refOk = !p.referencePrefix || candidates.some(c => c.gate.order.toUpperCase().startsWith(String(p.referencePrefix).toUpperCase()));
    return partyOk && materialOk && refOk;
  });
}

function isRelatedCompanyParty(w: Weighment, profile: ReconciliationProfile): boolean {
  // Only the WEIGHMENT's own recorded party decides this — a Gate record's
  // party field can legitimately carry the selling/handling unit's own name
  // as a data-entry convention (e.g. a byproduct sold on to a genuine
  // third-party buyer through a related unit's gate) while the real
  // counterparty is a normal external party; that must not be swept into
  // Others just because the gate happens to mention a related-entity name.
  const name = w.party.toUpperCase();
  return profile.seedTaxonomy.internalPartyTokens.some(token => name.includes(token.toUpperCase()));
}

export function classifyWeighment(w: Weighment, selectedCandidates: GateCandidate[], profile: ReconciliationProfile): { category: Category; reason: string; materialFamily: string } {
  const materialFamily = resolveMaterialFamily(w.material, profile);
  if (isJobWork(w, selectedCandidates, profile)) return { category: 'Job Work', reason: 'Job-work pattern matched (material/party/reference).', materialFamily };

  // A related/sister company's name on the party field means this is
  // inter-company movement, not an arm's-length commercial transaction —
  // true even when a real PO/SO reference exists on the gate record, since
  // that reference may just be internal bookkeeping between related
  // entities. Checked before order-based evidence for that reason.
  if (isRelatedCompanyParty(w, profile)) return { category: 'Others', reason: 'Party is a configured related/sister company — inter-company movement, not an arm\'s-length commercial transaction.', materialFamily };

  const withOrder = selectedCandidates.filter(c => c.gate.order);
  const outWithOrder = withOrder.filter(c => c.gate.direction === 'OUT');
  const inWithOrder = withOrder.filter(c => c.gate.direction === 'IN');
  if (outWithOrder.length) return { category: 'Sales', reason: 'Gate Out record with a Sales/Supplier Order reference is linked.', materialFamily };
  if (inWithOrder.length) return { category: 'Purchase', reason: 'Gate In record with a Purchase Order reference is linked.', materialFamily };

  // A configured non-commercial material (firewood, water, gunny, store
  // material, earth) STILL physically passes through a Gate — a firewood
  // delivery truck is gated in like any other — but that alone must never
  // promote it to Purchase/Sales. This check must run before the generic
  // "any gate direction, no order" fallback below, or every genuinely
  // internal movement gets miscounted as commercial (confirmed against the
  // real reviewed sample: Fire Wood/Water rows the reviewer marked Others
  // were being classified Purchase purely because Gate In had no order).
  if (profile.seedTaxonomy.othersMaterialFamilies.includes(materialFamily)) return { category: 'Others', reason: `Material family "${materialFamily}" is configured as a non-commercial movement.`, materialFamily };

  const anyOut = selectedCandidates.filter(c => c.gate.direction === 'OUT');
  const anyIn = selectedCandidates.filter(c => c.gate.direction === 'IN');
  if (anyOut.length && !anyIn.length) return { category: 'Sales', reason: 'Gate Out record is linked (no order reference recorded on the gate entry).', materialFamily };
  if (anyIn.length && !anyOut.length) return { category: 'Purchase', reason: 'Gate In record is linked (no order reference recorded on the gate entry).', materialFamily };

  return { category: 'Others', reason: 'No Gate In/Out record could be linked to this weighment, and the material is not a recognized commercial family.', materialFamily };
}
