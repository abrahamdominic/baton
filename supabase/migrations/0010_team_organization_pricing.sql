-- Keep the persisted billing catalog aligned with the application source of
-- truth. Stripe prices are immutable; after this migration an administrator
-- must use Admin > Plans > Sync Stripe Prices for Team and Organization so
-- replacement Stripe Price IDs at these amounts are stored on the plan rows.
-- Existing subscriptions are intentionally not repriced retroactively.

update public.plans
set monthly_price_cents = 1500,
    annual_price_cents = 15000,
    price_custom = false,
    currency = 'USD',
    updated_at = now()
where slug = 'team';

update public.plans
set monthly_price_cents = 4900,
    annual_price_cents = 49000,
    price_custom = false,
    currency = 'USD',
    updated_at = now()
where slug = 'organization';
