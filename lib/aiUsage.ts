import { supabaseAdmin } from '@/lib/supabase/admin';
import { currentUser } from '@/lib/auth';

// URUV model credits: every AI request the app makes is metered here. The
// provider is deliberately never named in anything a user can see — the
// dashboard speaks only of "URUV model credits" and URUV tiers.

/** Added on top of what the provider charges. Stored on every row. 44.45% at the default Rs 88 per dollar bills a $11.80 top-up as Rs 1,500 and a $5.90 top-up as Rs 750 (before GST). */
export const AI_MARKUP_PCT = 44.45;
/** GST on top of the charge. Shown on the dashboard and split out on the receipt. */
export const GST_PCT = 18;

/** Rupees per US$1, applied when a request is recorded and stored on its row. Set
 * AI_USD_INR_RATE on the server to the rate you bill at. */
export function usdInrRate(): number {
  const v = Number(process.env.AI_USD_INR_RATE);
  return Number.isFinite(v) && v > 0 ? v : 88;
}

/** 1 URUV credit = 1,000 tokens (input + output). Display unit only. */
export const TOKENS_PER_CREDIT = 1000;

type Rate = { input: number; cached: number; output: number; tier: string }; // USD per 1M tokens
const RATES: Record<string, Rate> = {
  'gpt-5-nano': { input: 0.05, cached: 0.005, output: 0.4, tier: 'URUV Nano' },
  'gpt-5-mini': { input: 0.25, cached: 0.025, output: 2, tier: 'URUV Lite' },
  'gpt-5': { input: 1.25, cached: 0.125, output: 10, tier: 'URUV Core' },
  'gpt-4.1-mini': { input: 0.4, cached: 0.1, output: 1.6, tier: 'URUV Lite' },
  'gpt-4.1': { input: 2, cached: 0.5, output: 8, tier: 'URUV Core' },
  'gpt-4o-mini': { input: 0.15, cached: 0.075, output: 0.6, tier: 'URUV Lite' },
  'gpt-4o': { input: 2.5, cached: 1.25, output: 10, tier: 'URUV Core' },
};
const KEYS_LONGEST_FIRST = Object.keys(RATES).sort((a, b) => b.length - a.length);
const FALLBACK = RATES['gpt-5-mini'];

/** Dated model ids ("gpt-5-mini-2025-08-07") resolve to their family's rate. */
export function rateFor(model: string): { rate: Rate; assumed: boolean } {
  const m = String(model || '').toLowerCase();
  const key = KEYS_LONGEST_FIRST.find(k => m === k || m.startsWith(k + '-') || m.startsWith(k));
  return key ? { rate: RATES[key], assumed: false } : { rate: FALLBACK, assumed: true };
}

/** What users see instead of the model's real name. */
export function tierLabel(model: string): string {
  const { rate, assumed } = rateFor(model);
  return assumed ? 'URUV Model' : rate.tier;
}

export type UsageInput = { input_tokens?: number; output_tokens?: number; total_tokens?: number; input_tokens_details?: { cached_tokens?: number }; output_tokens_details?: { reasoning_tokens?: number } } | null | undefined;

export function priceUsage(model: string, usage: UsageInput) {
  const input = Number(usage?.input_tokens || 0), output = Number(usage?.output_tokens || 0);
  const cached = Math.min(input, Number(usage?.input_tokens_details?.cached_tokens || 0));
  const reasoning = Number(usage?.output_tokens_details?.reasoning_tokens || 0);
  const total = Number(usage?.total_tokens || input + output);
  const { rate, assumed } = rateFor(model);
  const cost = ((input - cached) * rate.input + cached * rate.cached + output * rate.output) / 1_000_000;
  const providerCost = Number(cost.toFixed(6));
  const billed = Number((providerCost * (1 + AI_MARKUP_PCT / 100)).toFixed(6)), fx = usdInrRate();
  return { input, cached, output, reasoning, total, providerCost, billed, rate: fx, billedInr: Number((billed * fx).toFixed(4)), assumed };
}

/** Best-effort: a metering failure (table not created yet, DB blip) must
 * never break the AI feature that was being used. */
export async function recordAiUsage(args: { feature: string; model: string; usage: UsageInput; ms?: number }): Promise<void> {
  try {
    const p = priceUsage(args.model, args.usage);
    let userId: string | null = null;
    try { userId = (await currentUser())?.id ?? null; } catch { /* background job: no request context */ }
    await supabaseAdmin().from('ai_usage_log').insert({
      feature: args.feature || 'general', model: args.model || 'unknown', user_id: userId, status: 'ok',
      input_tokens: p.input, cached_input_tokens: p.cached, output_tokens: p.output, reasoning_tokens: p.reasoning, total_tokens: p.total,
      provider_cost_usd: p.providerCost, markup_pct: AI_MARKUP_PCT, billed_usd: p.billed, usd_inr_rate: p.rate, billed_inr: p.billedInr, price_assumed: p.assumed, duration_ms: args.ms ?? null,
    });
  } catch { /* ignored on purpose */ }
}
