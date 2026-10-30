-- URUV model credits — the top-ups invoiced after metering began, recorded at the amounts invoiced:
--   22 Oct 2026  $11.80 -> Rs 1,500     27 Oct 2026  $11.80 -> Rs 1,500   (before GST)
-- Same treatment as the earlier top-ups (sql/065): model 'earlier-usage', so they add credits and charge
-- but no request count; 44.45% markup at Rs 88 per dollar; tokens estimated at the blended $0.775 per 1M.
-- The invoices carry no time of day, so 12:00 IST is used. Safe to re-run (a row already present is not added again).

insert into public.ai_usage_log(
  created_at, feature, model, user_id, status,
  input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, total_tokens,
  provider_cost_usd, markup_pct, billed_usd, usd_inr_rate, billed_inr, price_assumed, duration_ms
)
select
  v.ts, 'Top-up (invoiced)', 'earlier-usage', null, 'ok',
  round(round(v.usd / 0.000000775) * 0.7)::int, 0, (round(v.usd / 0.000000775) - round(round(v.usd / 0.000000775) * 0.7))::int, 0, round(v.usd / 0.000000775)::int,
  v.usd, 44.45, round(v.inr / 88, 6), 88, v.inr, true, null
from (values
  ('2026-10-22 12:00:00+05:30'::timestamptz, 11.80::numeric, 1500::numeric),
  ('2026-10-27 12:00:00+05:30'::timestamptz, 11.80::numeric, 1500::numeric)
) as v(ts, usd, inr)
where not exists (
  select 1 from public.ai_usage_log l where l.feature = 'Top-up (invoiced)' and l.created_at = v.ts
);
