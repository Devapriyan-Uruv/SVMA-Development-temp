import { supabaseAdmin } from '@/lib/supabase/admin';
import { alnum, nameSimilarity } from '@/lib/reconciliation/normalize';

// A genuinely different-looking name that still scores this high against
// an existing product's display name is worth a human glance (e.g. "SOYA
// BARI - 10MM" vs "SOYABARI-10MM(PRB)" scores ~0.8) — never auto-merged,
// just queued in ops_product_merge_suggestions for review in
// app/operations/products (Possible Duplicates tab).
const MERGE_SUGGEST_THRESHOLD = 0.72;

/** Resolves raw ERP product text to a canonical ops_product_master row —
 * fully automatic, never blocks data population. The exact same source
 * text (any report type) reuses whatever product it already resolved to;
 * genuinely new text auto-creates a product AND an auto-approved alias in
 * the same call, so reconciliation can run immediately after upload with
 * no manual "approve this mapping" step in between.
 *
 * What this deliberately does NOT do: guess that two DIFFERENT-looking
 * texts are the same product and merge them itself — that stays a human
 * call, because auto-merging on a fuzzy name match risks silently
 * combining two genuinely different products (this file sits next to
 * several real near-miss pairs: different RICE BRAN OIL processing
 * stages, different DOC/PALMKERNAL grades, that must NOT be merged). A new
 * product's text is instead checked against every existing product name;
 * a high-similarity hit is recorded as a review item, never applied. */
export async function resolveProductIds(reportType: string, rawTexts: string[]): Promise<Map<string, string | null>> {
  const db = supabaseAdmin();
  const uniqueRaw = [...new Set(rawTexts.map(t => t.trim()).filter(Boolean))];
  const result = new Map<string, string | null>();
  if (!uniqueRaw.length) return result;
  const normOf = (t: string) => alnum(t);

  const norms = uniqueRaw.map(normOf);
  const { data: existingAliases } = await db.from('ops_product_aliases').select('product_id,source_text_normalized').in('source_text_normalized', norms).not('product_id', 'is', null);
  const productByNorm = new Map<string, string>((existingAliases || []).map((r: any) => [r.source_text_normalized, r.product_id]));

  const { data: products } = await db.from('ops_product_master').select('id,product_code,display_name').eq('active', true);
  const codeSet = new Set((products || []).map((p: any) => p.product_code));
  const productList = (products || []) as { id: string; product_code: string; display_name: string }[];

  // Confirmed against real Time Office Out data: a "Product Name" cell can
  // legitimately list several DIFFERENT products comma-joined when one
  // outward vehicle carries a mixed load (e.g. "Soya Bari - 25 mm, SOYA
  // BARI - 10MM"). Left unguarded, this text gets treated as if it were
  // one product's name, fabricating a nonsense merged "product" in
  // ops_product_master. Detect this — 2+ comma-separated segments that each
  // resolve to a DIFFERENT already-known product — and leave it unmapped
  // (raw text stays on the row; per-product split isn't captured by these
  // reports) rather than inventing a combined product.
  const isMultiProductText = (raw: string): boolean => {
    if (!raw.includes(',')) return false;
    const segmentIds = new Set(raw.split(',').map(s => productByNorm.get(normOf(s))).filter((id): id is string => !!id));
    return segmentIds.size >= 2;
  };

  for (const raw of uniqueRaw) {
    const n = normOf(raw);
    const existingId = productByNorm.get(n);
    if (existingId) { result.set(raw, existingId); continue; }
    if (isMultiProductText(raw)) { result.set(raw, null); continue; }

    let best: { id: string; score: number } | null = null;
    for (const p of productList) { const score = nameSimilarity(raw, p.display_name); if (!best || score > best.score) best = { id: p.id, score }; }

    let code = n.slice(0, 40) || 'PRODUCT', attempt = 1;
    while (codeSet.has(code)) { attempt++; code = `${n.slice(0, 36)}_${attempt}`; }
    const { data: newProduct, error } = await db.from('ops_product_master').insert({ product_code: code, display_name: raw, uom: 'MT' }).select('id').single();
    if (error || !newProduct) { result.set(raw, null); continue; }
    codeSet.add(code);
    const productId = (newProduct as any).id as string;
    await db.from('ops_product_aliases').insert({ product_id: productId, report_type: reportType, source_text: raw, source_text_normalized: n, status: 'approved', suggested_by: 'ai', confidence: 1, approved_at: new Date().toISOString() });
    productByNorm.set(n, productId);
    productList.push({ id: productId, product_code: code, display_name: raw });
    result.set(raw, productId);

    if (best && best.score >= MERGE_SUGGEST_THRESHOLD) {
      await db.from('ops_product_merge_suggestions').upsert({ keep_product_id: best.id, merge_product_id: productId, confidence: best.score, status: 'pending' }, { onConflict: 'keep_product_id,merge_product_id', ignoreDuplicates: true });
    }
  }
  return result;
}
