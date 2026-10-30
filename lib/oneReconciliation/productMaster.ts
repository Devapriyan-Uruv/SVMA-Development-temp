import { supabaseAdmin } from '@/lib/supabase/admin';
import { alnum, nameSimilarity, sequenceRatio } from '@/lib/reconciliation/normalize';
import { aix3Complete, aix3Enabled, parseAix3Json } from '@/lib/aix3/provider';

// Reads ops_product_master / ops_product_aliases — the SAME master already
// built and classified this session for Operations, shared read-only here
// (per explicit decision: one master, no duplicate copy). Deliberately does
// NOT reuse lib/ops/productMatch.ts's resolveProductIds(): that function
// auto-creates a new product on no match, which is exactly wrong for
// Finance — "Do NOT guess... never auto-create a financial reconciliation
// using a low-confidence product mapping" (per the spec). This module only
// ever reads; a miss returns NOT_FOUND, never writes anything.

export type MasterProduct = { id: string; productCode: string; displayName: string; category: string | null; productType: string | null };
export type ProductAlias = { productId: string; sourceTextNormalized: string };

export type ProductMasterIndex = { products: MasterProduct[]; aliasByNormalized: Map<string, string> };

export async function loadProductMaster(): Promise<ProductMasterIndex> {
  const db = supabaseAdmin();
  const [{ data: products }, { data: aliases }] = await Promise.all([
    db.from('ops_product_master').select('id,product_code,display_name,category,product_type').eq('active', true),
    db.from('ops_product_aliases').select('product_id,source_text_normalized').eq('status', 'approved').not('product_id', 'is', null),
  ]);
  return {
    products: (products || []).map((p: any) => ({ id: p.id, productCode: p.product_code, displayName: p.display_name, category: p.category, productType: p.product_type })),
    aliasByNormalized: new Map((aliases || []).map((a: any) => [a.source_text_normalized, a.product_id])),
  };
}

export type MatchMethod = 'exact' | 'normalized' | 'alias' | 'category' | 'ai_semantic' | 'lot_record' | 'erp_record' | 'not_found';
export type ProductMatch = {
  raw: string; normalized: string;
  masterProductId: string | null; masterProductName: string | null; masterCategory: string | null; masterProductType: string | null;
  matchMethod: MatchMethod; matchConfidence: number;
  aiSuggestion: { productId: string; productName: string; confidence: number } | null;
};

/** Exact Product Master Match -> Normalized Match -> Alias Match -> AI
 * Semantic Match -> NOT_FOUND, per the spec's own stated order. Never
 * silently replaces the source description — `raw` is always kept
 * alongside whatever matched. A NOT_FOUND still returns an aiSuggestion
 * when one exists, purely advisory — callers must never auto-apply it. */
export async function matchProduct(raw: string, index: ProductMasterIndex, opts: { allowAi?: boolean } = {}): Promise<ProductMatch> {
  const allowAi = opts.allowAi !== false;
  const normalized = alnum(raw);
  const base = { raw, normalized, aiSuggestion: null as ProductMatch['aiSuggestion'] };
  const notFound: ProductMatch = { ...base, masterProductId: null, masterProductName: null, masterCategory: null, masterProductType: null, matchMethod: 'not_found', matchConfidence: 0 };
  const hit = (p: MasterProduct, matchMethod: MatchMethod, matchConfidence: number): ProductMatch => ({ ...base, masterProductId: p.id, masterProductName: p.displayName, masterCategory: p.category, masterProductType: p.productType, matchMethod, matchConfidence });
  if (!raw.trim()) return notFound;

  // Exact match: raw text equals a master product's own code or display
  // name, normalized the same way.
  const exact = index.products.find(p => alnum(p.productCode) === normalized || alnum(p.displayName) === normalized);
  if (exact) return hit(exact, 'exact', 1);

  // Normalized match: same normalized form already resolved via a
  // different alias text (covers case/spacing/punctuation variants without
  // needing a stored alias row for every spelling).
  const aliasId = index.aliasByNormalized.get(normalized);
  if (aliasId) {
    const p = index.products.find(x => x.id === aliasId);
    if (p) return hit(p, 'normalized', 0.98);
  }

  // Alias match: near-spelling of a stored alias. Uses plain sequenceRatio,
  // NOT nameSimilarity — nameSimilarity gives a 0.96 "prefix" bonus built
  // for party names, which wrongly scored "RICE BRAN" against "RICE BRAN
  // OIL" (a different product) as a near-certain match on real data.
  let bestAlias: { productId: string; score: number } | null = null;
  for (const [aliasNorm, productId] of index.aliasByNormalized) {
    const score = sequenceRatio(normalized, aliasNorm);
    if (!bestAlias || score > bestAlias.score) bestAlias = { productId, score };
  }
  if (bestAlias && bestAlias.score >= 0.92) {
    const p = index.products.find(x => x.id === bestAlias!.productId);
    if (p) return hit(p, 'alias', bestAlias.score);
  }

  // Category match: the raw text is exactly a Product Master CATEGORY name
  // (e.g. the weighbridge just says "RICE BRAN" while the master only has
  // graded products under that category). Confident about the material
  // family, deliberately not claiming a specific product/grade — no
  // masterProductId is set. Product type is only carried over when every
  // product in the category agrees.
  const categoryProducts = index.products.filter(p => p.category && alnum(p.category) === normalized);
  if (categoryProducts.length) {
    const types = new Set(categoryProducts.map(p => p.productType).filter(Boolean));
    return { ...base, masterProductId: null, masterProductName: `${categoryProducts[0].category} (category)`, masterCategory: categoryProducts[0].category, masterProductType: types.size === 1 ? [...types][0]! : null, matchMethod: 'category', matchConfidence: 0.9 };
  }

  // Fuzzy match directly against master product names, as a candidate for
  // the AI semantic pass and as the NOT_FOUND suggestion either way.
  let bestProduct: { product: MasterProduct; score: number } | null = null;
  for (const p of index.products) { const score = nameSimilarity(raw, p.displayName); if (!bestProduct || score > bestProduct.score) bestProduct = { product: p, score }; }

  if (bestProduct && bestProduct.score >= 0.72 && allowAi && aix3Enabled()) {
    try {
      const candidates = index.products.filter(p => nameSimilarity(raw, p.displayName) >= 0.5).slice(0, 15).map(p => ({ id: p.id, name: p.displayName, category: p.category }));
      const instructions = 'You match a raw ERP material/product description to one of the supplied Product Master candidates for a Finance reconciliation system. Only ever pick from the supplied candidate list, by exact id, or say none match. NEVER invent a product or guess beyond the list. Return JSON only: {"productId":"<id from the list, or null>","confidence":0.0-1.0}';
      const ask = () => aix3Complete({ feature: 'Product Matching', instructions, input: JSON.stringify({ rawText: raw, candidates }), timeout: 20000 });
      const out = await ask().catch(() => ask()); // one retry — a transient provider failure must not turn a matchable product into Not Found
      const parsed = parseAix3Json<{ productId: string | null; confidence: number }>(out);
      const picked = parsed?.productId ? candidates.find(c => c.id === parsed.productId) : null;
      if (picked && parsed) {
        const p = index.products.find(x => x.id === picked.id)!;
        const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));
        if (confidence >= 0.75) return hit(p, 'ai_semantic', confidence);
        return { ...notFound, aiSuggestion: { productId: p.id, productName: p.displayName, confidence } };
      }
    } catch { /* falls through to NOT_FOUND below — never blocks the row */ }
  }

  return { ...notFound, aiSuggestion: bestProduct && bestProduct.score >= 0.5 ? { productId: bestProduct.product.id, productName: bestProduct.product.displayName, confidence: bestProduct.score } : null };
}

/** A weighment's material is free text typed at the weighbridge ("BRAN") and may not resolve on its own. The ERP's own record
 * for the resolved lot knows the product: the Operations lot's product, else the receipt's product text. Only used when the
 * weighment's own material did not match; never overrides a match, and the original text stays in `raw`. */
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
/** Every word typed at the weighbridge appears (as a word or a word's start) in the product's name or category — "BRAN" is
 * within "RICE BRAN", "SOYA FLOUR" is not within "Untosted Flour TPY". A lot that belongs to a different product is not a match. */
const isShorthandOf = (raw: string, ...names: (string | null)[]): boolean => {
  const rw = words(raw);
  if (!rw.length) return false;
  return names.some(n => { const nw = n ? words(n) : []; return nw.length > 0 && rw.every(w => nw.some(x => x === w || x.startsWith(w))); });
};
export async function productFromLotRecord(raw: string, lotProductId: string | null, receiptProduct: string, index: ProductMasterIndex): Promise<ProductMatch | null> {
  const base = { raw, normalized: alnum(raw), aiSuggestion: null as ProductMatch['aiSuggestion'] };
  const hit = (p: MasterProduct, matchConfidence: number): ProductMatch => ({ ...base, masterProductId: p.id, masterProductName: p.displayName, masterCategory: p.category, masterProductType: p.productType, matchMethod: 'lot_record', matchConfidence });
  const byId = lotProductId ? index.products.find(p => p.id === lotProductId) : null;
  if (byId) return hit(byId, 0.9);
  if (receiptProduct.trim()) {
    const m = await matchProduct(receiptProduct, index, { allowAi: false });
    if (m.matchMethod !== 'not_found') return { ...m, raw, normalized: base.normalized, matchMethod: 'lot_record', matchConfidence: Math.min(0.9, m.matchConfidence) };
  }
  return null;
}
