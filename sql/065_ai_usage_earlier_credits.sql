-- URUV model credits — usage from BEFORE the app started metering requests.
-- One row per top-up invoice (the amounts added so far), counted in full as consumed:
--   13 Aug 2026  $5.90     2 Sep 2026  $5.90     21 Sep 2026  $11.80
--   27 Sep 2026  $11.80    6 Oct 2026  $11.80      => $47.20
-- The invoice amount is the provider cost; the 44.45% markup, the rupee rate and
-- (on screen / receipt) GST are applied as for metered requests. Each top-up is billed at
-- the amount actually invoiced: $5.90 -> Rs 750, $11.80 -> Rs 1,500 (before GST).
--
-- Credits are APPROXIMATE: tokens are estimated from the amount at a blended
-- 70% input / 30% output mix ($0.775 per 1M tokens), so these rows are flagged
-- price_assumed = true and named "Earlier usage (estimated)". 1 credit = 1,000 tokens.
--
-- The rupee rate below (88) is the same default the app uses; change both here and
-- in AI_USD_INR_RATE if you bill at a different rate. Run once — safe to re-run
-- (a row already present for an invoice time is not added again).

insert into public.ai_usage_log(
  created_at, feature, model, user_id, status,
  input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, total_tokens,
  provider_cost_usd, markup_pct, billed_usd, usd_inr_rate, billed_inr, price_assumed, duration_ms
)
select
  v.ts, 'Earlier usage (estimated)', 'earlier-usage', null, 'ok',
  round(round(v.usd / 0.000000775) * 0.7)::int, 0, (round(v.usd / 0.000000775) - round(round(v.usd / 0.000000775) * 0.7))::int, 0, round(v.usd / 0.000000775)::int,
  v.usd, 44.45, round(v.inr / 88, 6), 88, v.inr, true, null
from (values
  ('2026-08-13 15:16:00+05:30'::timestamptz, 5.90::numeric, 750::numeric),
  ('2026-09-02 19:27:00+05:30'::timestamptz, 5.90::numeric, 750::numeric),
  ('2026-09-21 12:27:00+05:30'::timestamptz, 11.80::numeric, 1500::numeric),
  ('2026-09-27 17:18:00+05:30'::timestamptz, 11.80::numeric, 1500::numeric),
  ('2026-10-06 11:13:00+05:30'::timestamptz, 11.80::numeric, 1500::numeric)
) as v(ts, usd, inr)
where not exists (
  select 1 from public.ai_usage_log l where l.feature = 'Earlier usage (estimated)' and l.created_at = v.ts
);
