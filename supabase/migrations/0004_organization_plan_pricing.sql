-- ---------------------------------------------------------------------------
-- Update Organization plan pricing to $50/month (monthly: 5000 cents, annual: 48000 cents)
-- Self-serve checkout enabled (price_custom = false)
-- ---------------------------------------------------------------------------

update public.plans
set monthly_price_cents = 5000,
    annual_price_cents = 48000,
    price_custom = false,
    description = 'For scaling engineering organizations with compliance, unlimited repos, and priority SLAs.'
where slug = 'organization';

insert into public.plans (slug, name, description, monthly_price_cents, annual_price_cents, price_custom, currency, sort_order, is_active, is_public)
values ('organization', 'Organization', 'For scaling engineering organizations with compliance, unlimited repos, and priority SLAs.', 5000, 48000, false, 'USD', 20, true, true)
on conflict (slug) do update set
    monthly_price_cents = 5000,
    annual_price_cents = 48000,
    price_custom = false,
    description = 'For scaling engineering organizations with compliance, unlimited repos, and priority SLAs.';
