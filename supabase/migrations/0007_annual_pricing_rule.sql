-- ============================================================================
-- Enforce the exact 20% annual discount rule (data-only, idempotent).
--
-- Every non-custom plan prices annual billing at exactly 80% of 12 monthly
-- periods: annual_price_cents = round(monthly_price_cents * 12 * 4 / 5).
-- This matches the single source of truth (src/lib/billing/pricing.ts) and
-- the live Stripe annual prices provisioned for the Team and Organization
-- product lines. Custom-priced plans (price_custom = true) are untouched.
--
-- Pure UPDATE: no DDL, safe to apply on any environment.
-- ============================================================================

update public.plans
set annual_price_cents = round(monthly_price_cents * 12 * 4 / 5),
    updated_at = now()
where price_custom = false
  and monthly_price_cents > 0
  and annual_price_cents <> round(monthly_price_cents * 12 * 4 / 5);