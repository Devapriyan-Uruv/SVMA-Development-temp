-- URUV model credits — restate the individually logged requests that were billed at the old 20% markup to the 44.45% markup,
-- so one rate applies to the whole statement ($11.80 -> Rs 1,500 and $5.90 -> Rs 750 before GST, at Rs 88 per dollar).
-- Only metered requests still carrying markup_pct = 20 are touched; top-up rows and requests already at 44.45% are not.
-- Safe to re-run: once restated, no row carries 20 any more.

update public.ai_usage_log
set markup_pct = 44.45,
    billed_usd = round(provider_cost_usd * 1.4445, 6),
    billed_inr = round(provider_cost_usd * 1.4445 * usd_inr_rate, 4)
where model <> 'earlier-usage' and markup_pct = 20;
