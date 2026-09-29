-- ============================================================================
-- Re-align persisted plan entitlements and marketing copy with the
-- application source of truth (src/lib/billing/plan-catalog.ts).
--
-- Why this migration exists
-- -------------------------
-- 0006 projected the feature gates into `plans.limits.features` before the
-- repository-intelligence surface existed. It was never re-projected
-- afterwards, and 0010 (the $15/$150/$49/$490 repricing) updated prices only.
-- Because `plans.ts` reads the `plans` table and `activateSubscription` copies
-- `plan.limits` onto the subscription row, every paying customer on a migrated
-- database silently lost four advertised capabilities:
--   repo_intelligence, work_context, change_impact (Organization).
--
-- A later pass removed the standalone `briefings` gate: briefings are rendered
-- inside the repository-intelligence surface (gated by repo_intelligence) and
-- were never enforced as a separate key, so the marketing list and limits no
-- longer advertise them.
--
-- The same drift existed in the `features` marketing bullet list, which the
-- pricing page renders straight from the database, so the pricing page
-- advertised less than the product actually delivers.
--
-- This is a data-only migration. It re-asserts the exact catalog values, so
-- re-running it is a no-op and it can never degrade the prices set by 0010
-- (it does not touch the price columns at all).
--
-- Prices are deliberately absent from both the updates and the on-conflict
-- clause. 0010 already sets them unconditionally and runs before this file, and
-- a plan row is also where an administrator's own price change lives. Touching
-- the price columns here would silently revert a legitimate pricing decision
-- every time this migration was re-applied. plan-source-of-truth.test.ts asserts
-- that the on-conflict guard row still *carries* the catalog amounts, so a
-- database that never saw 0010 is seeded correctly.
-- ============================================================================

-- Team: $15 / $150, 25 members, the six Team feature gates.
update public.plans set
    price_custom = false,
    description = 'For engineering teams that want to ship fast and stop PR stalls.',
    features = '["Unlimited repositories","Deterministic state classifier","Per-repo customizable nudge thresholds","Automated @-mention reviewer nudges","Team-wide repository boards","Your Move queue with priority sorting","Evidence-backed repository intelligence","Saved work context"]'::jsonb,
    limits = '{"maxRepos": null, "maxMembers": 25, "features": ["custom_thresholds","team_workspace","unlimited_repos","repo_intelligence","work_context"]}'::jsonb,
    updated_at = now()
where slug = 'team';

-- Organization: $49 / $490, 1000 members, the ten Organization feature gates.
update public.plans set
    price_custom = false,
    description = 'For scaling engineering organizations with compliance, unlimited repos, and organization-wide control.',
    features = '["Everything in Team","Unlimited repositories & team members","Organization-wide review stall policies","Team roles, invitations & permissions with audit trail","Audit log export (CSV/JSON)","What Broke? CI investigation","Change impact analysis"]'::jsonb,
    limits = '{"maxRepos": null, "maxMembers": 1000, "features": ["custom_thresholds","team_workspace","organization_workspace","organization_policies","audit_export","unlimited_repos","repo_intelligence","work_context","change_impact"]}'::jsonb,
    updated_at = now()
where slug = 'organization';

-- Guard rows for environments where the plan rows were never seeded. These
-- mirror the catalog exactly, including the 0010 prices, so re-running this
-- migration is a no-op rather than a regression.
insert into public.plans (slug, name, description, monthly_price_cents, annual_price_cents, price_custom, currency, features, limits, sort_order, is_active, is_public)
values
    ('team', 'Team', 'For engineering teams that want to ship fast and stop PR stalls.', 1500, 15000, false, 'USD',
     '["Unlimited repositories","Deterministic state classifier","Per-repo customizable nudge thresholds","Automated @-mention reviewer nudges","Team-wide repository boards","Your Move queue with priority sorting","Evidence-backed repository intelligence","Saved work context"]'::jsonb,
     '{"maxRepos": null, "maxMembers": 25, "features": ["custom_thresholds","team_workspace","unlimited_repos","repo_intelligence","work_context"]}'::jsonb, 10, true, true),
    ('organization', 'Organization', 'For scaling engineering organizations with compliance, unlimited repos, and organization-wide control.', 4900, 49000, false, 'USD',
     '["Everything in Team","Unlimited repositories & team members","Organization-wide review stall policies","Team roles, invitations & permissions with audit trail","Audit log export (CSV/JSON)","What Broke? CI investigation","Change impact analysis"]'::jsonb,
     '{"maxRepos": null, "maxMembers": 1000, "features": ["custom_thresholds","team_workspace","organization_workspace","organization_policies","audit_export","unlimited_repos","repo_intelligence","work_context","change_impact"]}'::jsonb, 20, true, true)
on conflict (slug) do update set
    name = excluded.name,
    description = excluded.description,
    price_custom = excluded.price_custom,
    features = excluded.features,
    limits = excluded.limits,
    updated_at = now();
