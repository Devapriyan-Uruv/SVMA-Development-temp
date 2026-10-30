import type { GateCandidate } from '@/lib/reconciliation/candidates';
import { DEFAULT_SEED_TAXONOMY } from '@/lib/reconciliation/profile';
import type { ProductMatch } from './productMaster';

// Purchase/Sales/Inter-Job Work/Others separation, Product-Master-driven
// per the spec: "Do NOT hard-code individual material names in application
// code if the Product Master already contains the required classification."
// Product Master category/product_type is the PRIMARY signal; Gate
// direction/order evidence (built by the reused candidate machinery) is a
// secondary validator/tie-breaker — it can confirm or refine, but a
// confident Product Master signal is never silently overridden by a single
// ambiguous gate record. When the Product Master match is NOT_FOUND, gate
// evidence becomes the only signal available (still never guessed from raw
// text alone), and the row is separately forced into REVIEW REQUIRED
// upstream regardless of what category this returns.

export type Category = 'Purchase' | 'Sales' | 'Inter/Job Work' | 'Others';

function looksLikeJobWork(materialRaw: string, candidates: GateCandidate[]): boolean {
  if (/\bJOB\s*[- ]?WORK\b/i.test(materialRaw)) return true;
  return candidates.some(c => /\bJOW?[-\s]?(PO|SO)\b/i.test(c.gate.order) || /\bJOB\s*[- ]?WORK\b/i.test(c.gate.order));
}

// The group's own related entities (letterhead names — a stable structural
// fact, same seed list the existing engine uses; values-only import).
function isInterCompany(party: string, candidates: GateCandidate[]): boolean {
  const names = [party, ...candidates.map(c => c.gate.party)].map(n => n.toUpperCase());
  return DEFAULT_SEED_TAXONOMY.internalPartyTokens.some(t => names.some(n => n.includes(t.toUpperCase())));
}

/** True when the name is one of the group's own related companies (e.g. SVMA Soya Foods, Maxi Bio). Used to label a sale as a group-company sale. */
export function isGroupParty(name: string): boolean {
  const n = String(name || '').toUpperCase();
  return !!n && DEFAULT_SEED_TAXONOMY.internalPartyTokens.some(t => n.includes(t.toUpperCase()));
}

// Products that are purchases by nature even when no Gate In record could be linked to the weighment, and whose Product Master entry
// carries no raw-material type (setting that type would send them through the lot / ERP-receipt checks they do not have). Only
// reached when there is no gate evidence at all, so a row already classified from a gate record never changes.
const PURCHASE_BY_NATURE = /^FIRE\s*WOOD$/i;
export const PURCHASE_BY_NATURE_REASON = 'Product is a purchase by nature (firewood) and no Gate record is linked.';

export function classifyTransaction(materialRaw: string, party: string, product: ProductMatch, candidates: GateCandidate[]): { category: Category; reason: string } {
  if (looksLikeJobWork(materialRaw, candidates)) return { category: 'Inter/Job Work', reason: 'Job-work pattern matched (material text or gate order reference).' };
  if (isInterCompany(party, candidates)) return { category: 'Inter/Job Work', reason: 'Counterparty is one of the group\'s own related companies — inter-company movement, not an arm\'s-length purchase or sale.' };

  if (product.masterProductId && product.matchMethod !== 'not_found') {
    if ((product.masterCategory || '').toUpperCase().includes('PACKING')) return { category: 'Others', reason: `Product Master category "${product.masterCategory}" is packing material — non-commercial movement.` };
  }

  // A vehicle can legitimately appear in BOTH a same-day Gate In and a
  // same-day Gate Out — one truck dropping off one supplier's load and
  // picking up an unrelated outbound one — and material text similarity
  // alone ("RICE BRAN" inside "DE OILED RICE BRAN...") is loose enough that
  // the wrong direction's gate record can still pass the candidate filter.
  // Direction is therefore decided by whichever side has the STRONGER
  // match, never "OUT always wins whenever any OUT candidate exists" —
  // party-name similarity (already scored per candidate, the most specific
  // signal available here) is the tie-breaker: a near-exact party match on
  // one side against a same-vehicle coincidence on the other is decisive.
  const bestOf = (list: GateCandidate[]): GateCandidate | null => list.reduce((best: GateCandidate | null, c) => (!best || c.partyScore > best.partyScore || (c.partyScore === best.partyScore && c.materialScore > best.materialScore)) ? c : best, null);

  const withOrder = candidates.filter(c => c.gate.order);
  const bestOutOrdered = bestOf(withOrder.filter(c => c.gate.direction === 'OUT'));
  const bestInOrdered = bestOf(withOrder.filter(c => c.gate.direction === 'IN'));
  if (bestOutOrdered || bestInOrdered) {
    if (bestOutOrdered && (!bestInOrdered || bestOutOrdered.partyScore >= bestInOrdered.partyScore)) return { category: 'Sales', reason: 'Gate Out record with a Sales Order reference is linked.' };
    return { category: 'Purchase', reason: 'Gate In record with a Purchase Order reference is linked.' };
  }

  const bestOutAny = bestOf(candidates.filter(c => c.gate.direction === 'OUT'));
  const bestInAny = bestOf(candidates.filter(c => c.gate.direction === 'IN'));
  if (bestOutAny || bestInAny) {
    if (bestOutAny && (!bestInAny || bestOutAny.partyScore >= bestInAny.partyScore)) return { category: 'Sales', reason: 'Gate Out record is linked (no order reference recorded on the gate entry).' };
    return { category: 'Purchase', reason: 'Gate In record is linked (no order reference recorded on the gate entry).' };
  }

  if (PURCHASE_BY_NATURE.test(String(materialRaw || '').trim()) || PURCHASE_BY_NATURE.test(String(product.masterProductName || '').trim())) return { category: 'Purchase', reason: PURCHASE_BY_NATURE_REASON };

  // No usable gate evidence — fall back to the Product Master's own
  // finished-good/raw-material classification (raw material arrives via
  // Purchase, finished goods leave via Sales), only when the product was
  // actually found; a NOT_FOUND product never gets a guessed category from
  // this fallback.
  if (product.masterProductType === 'raw_material') return { category: 'Purchase', reason: 'No Gate record linked; Product Master classifies this as raw material (typically purchased).' };
  if (product.masterProductType === 'finished_good') return { category: 'Sales', reason: 'No Gate record linked; Product Master classifies this as a finished good (typically dispatched).' };

  return { category: 'Others', reason: product.matchMethod === 'not_found' ? 'No Gate In/Out record could be linked, and the material could not be confidently matched to the Product Master.' : 'No Gate In/Out record could be linked to this weighment.' };
}
