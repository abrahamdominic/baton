-- ---------------------------------------------------------------------------
-- Fix Team plan annual pricing to the exact 20% discount on the monthly rate.
--
-- Team is $10/user/month (1000 cents). The annual price must therefore be
-- 12 x 1000 x 0.8 = 9600 cents ($96/user/year), matching the public pricing
-- and the single source of truth in src/lib/billing/plans.ts.
-- ---------------------------------------------------------------------------

update public.plans
set annual_price_cents = 15000
where slug = 'team';

-- Guard: the seeded seed row in 0001 stored 800 cents (8 monthly equivalents).
-- Re-assert the intended value regardless of how the row was inserted.
insert into public.plans (slug, name, description, monthly_price_cents, annual_price_cents, price_custom, currency, sort_order, is_active, is_public)
values ('team', 'Team', 'For engineering teams that want to ship fast and stop PR stalls.', 1000, 9600, false, 'USD', 10, true, true)
on conflict (slug) do update set
    annual_price_cents = 9600;