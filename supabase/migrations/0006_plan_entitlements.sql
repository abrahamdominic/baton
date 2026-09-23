-- ============================================================================
-- Baton plan entitlements (data-only, idempotent).
--
-- Project `feature gates` into plan limits so the entitlement resolver
-- (src/lib/billing/entitlement.ts) can derive them without extra source edits.
-- Also re-asserts the Team annual price (9600c) that 0005 introduced, and
-- drops marketing claims (SSO/SLA) that are not delivered as product features.
--
-- Pure UPDATE / UPSERT statements: no DDL, safe to apply on any environment.
-- ============================================================================

-- Team annual price: $96/user/year (exact 20% off $120).
update public.plans set annual_price_cents = 9600 where slug = 'team';

update public.plans set
    price_custom = false,
    description = 'For engineering teams that want to ship fast and stop PR stalls.',
    features = '["Unlimited repositories","Deterministic state classifier","Per-repo customizable nudge thresholds","Automated @-mention reviewer nudges","Team-wide repository boards","Your Move queue with priority sorting"]'::jsonb,
    limits = '{"maxRepos": null, "maxMembers": 25, "features": ["custom_thresholds","team_workspace","unlimited_repos"]}'::jsonb,
    updated_at = now()
where slug = 'team';

update public.plans set
    price_custom = false,
    description = 'For scaling engineering organizations with compliance, unlimited repos, and organization-wide control.',
    features = '["Everything in Team","Unlimited repositories & team members","Organization-wide review stall policies","Team roles, invitations & permissions with audit trail","Audit log export (CSV/JSON)"]'::jsonb,
    limits = '{"maxRepos": null, "maxMembers": 1000, "features": ["custom_thresholds","team_workspace","organization_workspace","organization_policies","audit_export","unlimited_repos"]}'::jsonb,
    updated_at = now()
where slug = 'organization';

-- Guard rows (mirrors 0004/0005 data so re-seeding can never degrade prices).
insert into public.plans (slug, name, description, monthly_price_cents, annual_price_cents, price_custom, currency, features, limits, sort_order, is_active, is_public)
values
    ('team', 'Team', 'For engineering teams that want to ship fast and stop PR stalls.', 1000, 9600, false, 'USD',
     '["Unlimited repositories","Deterministic state classifier","Per-repo customizable nudge thresholds","Automated @-mention reviewer nudges","Team-wide repository boards","Your Move queue with priority sorting"]'::jsonb,
     '{"maxRepos": null, "maxMembers": 25, "features": ["custom_thresholds","team_workspace","unlimited_repos"]}'::jsonb, 10, true, true),
    ('organization', 'Organization', 'For scaling engineering organizations with compliance, unlimited repos, and organization-wide control.', 5000, 48000, false, 'USD',
     '["Everything in Team","Unlimited repositories & team members","Organization-wide review stall policies","Team roles, invitations & permissions with audit trail","Audit log export (CSV/JSON)"]'::jsonb,
     '{"maxRepos": null, "maxMembers": 1000, "features": ["custom_thresholds","team_workspace","organization_workspace","organization_policies","audit_export","unlimited_repos"]}'::jsonb, 20, true, true)
on conflict (slug) do update set
    monthly_price_cents = excluded.monthly_price_cents,
    annual_price_cents = excluded.annual_price_cents,
    price_custom = excluded.price_custom,
    features = excluded.features,
    limits = excluded.limits,
    updated_at = now();