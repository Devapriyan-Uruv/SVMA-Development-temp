
import { supabaseAdmin } from '@/lib/supabase/admin';
import { currentUser } from '@/lib/auth';

// URUV model credits: provider details are kept internal.

export const AI_MARKUP_PCT = 44.45;
export const GST_PCT = 18;

export function usdInrRate(): number {
  const value = Number(process.env.AI_USD_INR_RATE);
  return Number.isFinite(value) && value > 0 ? value : 88;
}

export const TOKENS_PER_CREDIT = 1000;

type Rate = {
  input: number;
  cached: number;
  output: number;
  tier: string;
};

// Retained for display compatibility only.
// These rates are no longer used to calculate provider cost.
const RATES: Record<string, Rate> = {
  'uruv-light': {
    input: 0,
    cached: 0,
    output: 0,
    tier: 'URUV Lite',
  },
  'uruv-heavy': {
    input: 0,
    cached: 0,
    output: 0,
    tier: 'URUV Heavy',
  },
};

const FALLBACK: Rate = {
  input: 0,
  cached: 0,
  output: 0,
  tier: 'URUV Model',
};

export function rateFor(model: string): {
  rate: Rate;
  assumed: boolean;
} {
  const normalized = String(model || '').toLowerCase();
  const rate = RATES[normalized];

  return {
    rate: rate || FALLBACK,
    assumed: !rate,
  };
}

export function tierLabel(model: string): string {
  return rateFor(model).rate.tier;
}

export type UsageInput = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: {
    cached_tokens?: number;
  };
  output_tokens_details?: {
    reasoning_tokens?: number;
  };
} | null | undefined;

export function priceUsage(
  model: string,
  usage: UsageInput,
  exactCostUsd?: number
) {
  const input = Number(usage?.input_tokens || 0);
  const output = Number(usage?.output_tokens || 0);
  const cached = Math.min(
    input,
    Number(usage?.input_tokens_details?.cached_tokens || 0)
  );
  const reasoning = Number(
    usage?.output_tokens_details?.reasoning_tokens || 0
  );
  const total = Number(usage?.total_tokens || input + output);

  const validExactCost =
    exactCostUsd !== undefined &&
    Number.isFinite(exactCostUsd) &&
    exactCostUsd >= 0;

  // Use the exact cost supplied by URUV. Never estimate from token rates.
  const providerCost = validExactCost
    ? Number(exactCostUsd.toFixed(6))
    : 0;

  const billed = Number(
    (providerCost * (1 + AI_MARKUP_PCT / 100)).toFixed(6)
  );

  const fx = usdInrRate();

  return {
    input,
    cached,
    output,
    reasoning,
    total,
    providerCost,
    billed,
    rate: fx,
    billedInr: Number((billed * fx).toFixed(4)),
    assumed: !validExactCost,
  };
}

/**
 * Best-effort usage recording.
 * Metering failures must never break the AI feature.
 */
export async function recordAiUsage(args: {
  feature: string;
  model: string;
  usage: UsageInput;
  ms?: number;
  costUsd?: number;
  requestId?: string | null;
}): Promise<void> {
  try {
    const pricing = priceUsage(
      args.model,
      args.usage,
      args.costUsd
    );

    let userId: string | null = null;

    try {
      userId = (await currentUser())?.id ?? null;
    } catch {
      // Background job: no request context.
    }

    const { error } = await supabaseAdmin()
      .from('ai_usage_log')
      .insert({
        feature: args.feature || 'general',
        model: args.model || 'unknown',
        user_id: userId,
        status: 'ok',
        input_tokens: pricing.input,
        cached_input_tokens: pricing.cached,
        output_tokens: pricing.output,
        reasoning_tokens: pricing.reasoning,
        total_tokens: pricing.total,
        provider_cost_usd: pricing.providerCost,
        markup_pct: AI_MARKUP_PCT,
        billed_usd: pricing.billed,
        usd_inr_rate: pricing.rate,
        billed_inr: pricing.billedInr,
        price_assumed: pricing.assumed,
        duration_ms: args.ms ?? null,
        request_id: args.requestId ?? null,
      });

    if (error) {
      console.error('AI usage logging failed:', error.message);
    }
  } catch (error) {
    console.error('AI usage recording failed:', error);
  }
}
