import { supabaseAdmin } from '@/lib/supabase/admin';

// Persistent SVMA_RECONCILIATION_PROFILE: thresholds/weights + learned
// alias/document-family/job-work knowledge. Loaded once per run and passed
// through the engine — nothing here is a sample-day value.

export type ScoringWeights = {
  gateVehicleExact: number; gateSameDay: number; gateMaterialMatch: number; gatePartyMatch: number; gateOrderPresent: number;
  tallyOrderReferenceMatch: number; tallyInvoiceMatch: number; tallyPartyMatch: number; tallyBookingStage: number; tallySupportingOnly: number; tallyDirectionMismatchPenalty: number; tallyDateProximityBonus: number; tallyDateFarPenalty: number;
};
// Calibrated against the real two-day reference sample (see conversation):
// a genuine Purchase Receipt-Note booking voucher almost never shares a
// literal reference string with the Gate In Purchase Order (PO and RN are
// different document families in this business), so party + booking-stage +
// date-proximity has to be able to stand on its own as strong evidence — an
// exact reference match is the strongest signal when it exists, but its
// absence must not force every genuine match into permanent Review.
export const DEFAULT_WEIGHTS: ScoringWeights = {
  gateVehicleExact: 30, gateSameDay: 15, gateMaterialMatch: 25, gatePartyMatch: 20, gateOrderPresent: 10,
  tallyOrderReferenceMatch: 35, tallyInvoiceMatch: 15, tallyPartyMatch: 35, tallyBookingStage: 30, tallySupportingOnly: -25, tallyDirectionMismatchPenalty: -40, tallyDateProximityBonus: 20, tallyDateFarPenalty: -10,
};

export type Thresholds = {
  gateVehicleWindowDays: number;
  gateNameThreshold: number;
  tallyNameThreshold: number;
  autoReconcileMin: number; // >= this: AUTO RECONCILE
  aiExplainMin: number; // >= this: AUTO RECONCILE WITH AI EXPLANATION
  secondPassMin: number; // >= this: run AI second pass; below: review/not-found
  dominantMargin: number; // candidate A wins outright if A - B >= this
  weights: ScoringWeights;
};

export const DEFAULT_THRESHOLDS: Thresholds = {
  gateVehicleWindowDays: 1,
  gateNameThreshold: 0.84,
  tallyNameThreshold: 0.86,
  autoReconcileMin: 95,
  aiExplainMin: 88,
  secondPassMin: 75,
  dominantMargin: 10,
  weights: DEFAULT_WEIGHTS,
};

// Seed taxonomy is a bootstrap default only, sourced from the reference
// sample days — every one of these is overridable/extendable by the learned
// alias tables below, and none of it is treated as permanent when new
// materials/prefixes/parties appear on a different day.
export type SeedTaxonomy = {
  othersMaterialFamilies: string[]; // e.g. FIREWOOD, WATER, GUNNY, STORE MATERIAL — genuinely non-commercial movements
  internalPartyTokens: string[]; // substrings identifying the organization's own related entities (job-work/internal moves)
  // Materials that are genuine Purchase/Sales movements — shown normally in
  // Main/Purchase/Sales and their own status (Reconciled/Partial/Not Found)
  // — but whose booking is known to live in a separate Tally system this
  // upload never contains, confirmed by checking the actual source file
  // (no reference to it anywhere). Excluding them from the reconciliation
  // %/automation % denominator stops a structurally-unmatchable material
  // from dragging those numbers down for something the uploaded data was
  // never going to contain in the first place.
  accuracyExemptMaterialFamilies: string[];
};
export const DEFAULT_SEED_TAXONOMY: SeedTaxonomy = {
  // Firewood is a genuine commercial purchase (a supplier, an invoice, a
  // Gate In record — boiler fuel) and belongs in Purchase, not Others.
  othersMaterialFamilies: ['WATER', 'GUNNY', 'STORE MATERIAL', 'EARTH'],
  // The operating group's own related-entity names are a stable structural
  // fact of this deployment (they appear as the letterhead on every one of
  // its own source documents), unlike a daily supplier/customer name —
  // admin-editable via the profile, not a fixed classification rule.
  internalPartyTokens: ['SVMA', 'MAXI BIO OLEOS'],
  // Empty by default. An earlier version of this list held 'SOYABARI',
  // based on one older sample day whose upload happened not to include a
  // Soyabari voucher — a real production Day Book later showed a genuine
  // dedicated "Sales-Soya Bari- ERP" booking type with real SBARI/xxx
  // references, proving that exemption wrong as a general rule. The real
  // gap that day was a party-matching bug (candidate pooling only checked
  // the Gate record's party, not the weighment's own — see
  // engine.ts::tallyCandidatePool), not an absent Tally structure. Left as
  // a mechanism for genuinely confirmed cases, just not pre-populated with
  // one anymore.
  accuracyExemptMaterialFamilies: [],
};

export type PartyAlias = { id: string; canonicalName: string; aliasNormalized: string; confidence: number; verified: boolean };
export type MaterialAlias = { id: string; canonicalFamily: string; aliasNormalized: string; confidence: number; verified: boolean };
export type DocumentFamily = { id: string; prefix: string; direction: 'PURCHASE' | 'SALES' | 'JOB_WORK' | 'UNKNOWN'; stage: 'ORDER' | 'BOOKING' | 'SUPPORTING'; confidence: number; sampleCount: number; observedDays: number; verified: boolean };
export type JobWorkRule = { id: string; pattern: Record<string, unknown>; confidence: number; verified: boolean };

export type ReconciliationProfile = {
  version: number;
  thresholds: Thresholds;
  seedTaxonomy: SeedTaxonomy;
  partyAliases: PartyAlias[];
  materialAliases: MaterialAlias[];
  documentFamilies: DocumentFamily[];
  jobWorkRules: JobWorkRule[];
};

export async function loadProfile(): Promise<ReconciliationProfile> {
  const db = supabaseAdmin();
  const [profileRes, partyRes, materialRes, familyRes, jobWorkRes] = await Promise.all([
    db.from('svma_reconciliation_profile').select('*').eq('id', 'default').maybeSingle(),
    db.from('reconciliation_party_aliases').select('id,canonical_name,alias_normalized,confidence,verified'),
    db.from('reconciliation_material_aliases').select('id,canonical_family,alias_normalized,confidence,verified'),
    db.from('reconciliation_document_families').select('id,prefix,direction,stage,confidence,sample_count,observed_days,verified'),
    db.from('reconciliation_job_work_rules').select('id,pattern,confidence,verified'),
  ]);
  const row = profileRes.data as any;
  return {
    version: row?.version ?? 1,
    thresholds: { ...DEFAULT_THRESHOLDS, ...(row?.thresholds || {}) },
    seedTaxonomy: { ...DEFAULT_SEED_TAXONOMY, ...(row?.seed_taxonomy || {}) },
    partyAliases: (partyRes.data || []).map((r: any) => ({ id: r.id, canonicalName: r.canonical_name, aliasNormalized: r.alias_normalized, confidence: Number(r.confidence), verified: !!r.verified })),
    materialAliases: (materialRes.data || []).map((r: any) => ({ id: r.id, canonicalFamily: r.canonical_family, aliasNormalized: r.alias_normalized, confidence: Number(r.confidence), verified: !!r.verified })),
    documentFamilies: (familyRes.data || []).map((r: any) => ({ id: r.id, prefix: r.prefix, direction: r.direction, stage: r.stage, confidence: Number(r.confidence), sampleCount: r.sample_count, observedDays: r.observed_days, verified: !!r.verified })),
    jobWorkRules: (jobWorkRes.data || []).map((r: any) => ({ id: r.id, pattern: r.pattern || {}, confidence: Number(r.confidence), verified: !!r.verified })),
  };
}

/** Best-effort persistence of newly-observed document-family evidence and
 * alias candidates from one run. Never overwrites a verified/human-confirmed
 * row with unverified inference, and always accumulates sample_count/observed_days
 * rather than replacing — this is what lets confidence grow across days
 * (cross-day validation) instead of resetting each run. */
export async function upsertDocumentFamilyObservations(observations: { prefix: string; direction: string; stage: string; evidence: string; day: string }[]): Promise<void> {
  if (!observations.length) return;
  const db = supabaseAdmin();
  const grouped = new Map<string, { prefix: string; direction: string; stage: string; evidenceSet: Set<string>; days: Set<string> }>();
  for (const o of observations) {
    if (!o.prefix) continue;
    const key = `${o.prefix}|${o.direction}|${o.stage}`;
    const g = grouped.get(key) || { prefix: o.prefix, direction: o.direction, stage: o.stage, evidenceSet: new Set<string>(), days: new Set<string>() };
    g.evidenceSet.add(o.evidence);
    g.days.add(o.day);
    grouped.set(key, g);
  }
  for (const g of grouped.values()) {
    const { data: existing } = await db.from('reconciliation_document_families').select('id,sample_count,observed_days,confidence,verified,evidence').eq('prefix', g.prefix).eq('direction', g.direction).eq('stage', g.stage).maybeSingle();
    const today = new Date().toISOString().slice(0, 10);
    if (existing) {
      if ((existing as any).verified) continue; // never downgrade a human-verified rule
      const newSampleCount = (existing as any).sample_count + g.evidenceSet.size;
      const priorEvidence: string[] = Array.isArray((existing as any).evidence) ? (existing as any).evidence : [];
      const confidence = Math.min(0.99, 0.5 + Math.log10(1 + newSampleCount) * 0.25);
      await db.from('reconciliation_document_families').update({
        sample_count: newSampleCount,
        observed_days: (existing as any).observed_days + g.days.size,
        confidence,
        evidence: [...new Set([...priorEvidence, ...g.evidenceSet])].slice(-20),
        last_seen: today,
        updated_at: new Date().toISOString(),
      }).eq('id', (existing as any).id);
    } else {
      await db.from('reconciliation_document_families').insert({
        prefix: g.prefix, direction: g.direction, stage: g.stage,
        confidence: 0.55, sample_count: g.evidenceSet.size, observed_days: g.days.size,
        evidence: [...g.evidenceSet], first_seen: today, last_seen: today,
      });
    }
  }
}
