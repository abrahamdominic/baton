-- ============================================================================
-- Baton billing, payments, subscriptions, and admin store (Supabase backend).
--
-- Identity: Baton signs users in with GitHub OAuth and keeps the session in
-- its own Postgres schema. `user_id` columns here reference Baton's `User.id`
-- (a cuid string). The application only ever reaches these tables server-side
-- through the service role.
--
-- RLS posture: every sensitive table has RLS enabled and the anon /
-- authenticated (public key) roles are REVOKED outright, so even a leaked
-- publishable key cannot read or write billing data. Access control for
-- "who is allowed to see what" is enforced in the server layer on top of the
-- session identity; admin authorization is never a frontend concern.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Plans (what Baton sells; pricing source of truth for the public site too)
-- ---------------------------------------------------------------------------
create table if not exists public.plans (
    id                     uuid primary key default gen_random_uuid(),
    slug                   text not null unique,
    name                   text not null,
    description            text,
    monthly_price_cents    integer not null default 0 check (monthly_price_cents >= 0),
    annual_price_cents     integer not null default 0 check (annual_price_cents >= 0),
    price_custom           boolean not null default false,
    currency               text not null default 'USD',
    features               jsonb not null default '[]'::jsonb,
    limits                 jsonb not null default '{}'::jsonb,
    stripe_product_id      text,
    stripe_monthly_price_id text,
    stripe_annual_price_id text,
    is_active              boolean not null default true,
    is_public              boolean not null default true,
    sort_order             integer not null default 0,
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Subscriptions (entitlement — separate from payments)
-- ---------------------------------------------------------------------------
create table if not exists public.subscriptions (
    id                       uuid primary key default gen_random_uuid(),
    user_id                  text not null,
    plan_id                  uuid not null references public.plans(id),
    status                   text not null check (status in (
        'none', 'pending', 'active', 'active_until_period_end',
        'past_due', 'payment_failed', 'canceled', 'expired'
    )),
    payment_provider         text check (payment_provider in ('stripe', 'usdc')),
    provider_customer_id     text,
    provider_subscription_id text unique,
    current_period_start     timestamptz,
    current_period_end       timestamptz,
    cancel_at_period_end     boolean not null default false,
    canceled_at              timestamptz,
    started_at               timestamptz,
    ended_at                 timestamptz,
    created_at               timestamptz not null default now(),
    updated_at               timestamptz not null default now()
);

create index if not exists subscriptions_user_id_idx on public.subscriptions (user_id);
create index if not exists subscriptions_status_idx on public.subscriptions (status);
create index if not exists subscriptions_plan_id_idx on public.subscriptions (plan_id);
create index if not exists subscriptions_period_end_idx on public.subscriptions (current_period_end);
create index if not exists subscriptions_provider_sub_id_idx on public.subscriptions (provider_subscription_id);

-- ---------------------------------------------------------------------------
-- Payments (a single payment attempt; never a substitute for a subscription)
-- ---------------------------------------------------------------------------
create table if not exists public.payments (
    id                          uuid primary key default gen_random_uuid(),
    user_id                     text not null,
    subscription_id             uuid references public.subscriptions(id) on delete set null,
    plan_id                     uuid not null references public.plans(id),
    payment_provider            text not null check (payment_provider in ('stripe', 'usdc')),
    payment_type                text not null check (payment_type in
        ('initial_subscription', 'renewal', 'plan_change', 'one_time')),
    status                      text not null check (status in
        ('pending', 'pending_verification', 'confirmed', 'failed', 'rejected', 'refunded')),
    amount                      integer not null check (amount >= 0),
    currency                    text not null default 'USD',
    stripe_payment_intent_id    text unique,
    stripe_checkout_session_id  text unique,
    stripe_invoice_id           text unique,
    crypto_network              text,
    crypto_token                text,
    crypto_wallet_address       text,
    crypto_transaction_hash     text unique,
    failure_reason              text,
    metadata                    jsonb not null default '{}'::jsonb,
    created_at                  timestamptz not null default now(),
    updated_at                  timestamptz not null default now(),
    paid_at                     timestamptz
);

create index if not exists payments_user_id_idx on public.payments (user_id);
create index if not exists payments_subscription_id_idx on public.payments (subscription_id);
create index if not exists payments_status_idx on public.payments (status);
create index if not exists payments_provider_idx on public.payments (payment_provider);
create index if not exists payments_created_at_idx on public.payments (created_at);

-- ---------------------------------------------------------------------------
-- Subscription events (immutable lifecycle history)
-- ---------------------------------------------------------------------------
create table if not exists public.subscription_events (
    id              uuid primary key default gen_random_uuid(),
    subscription_id uuid references public.subscriptions(id) on delete set null,
    user_id         text not null,
    event_type      text not null,
    previous_status text,
    new_status      text,
    previous_plan_id uuid,
    new_plan_id     uuid,
    payment_id      uuid references public.payments(id) on delete set null,
    source          text not null default 'system' check (source in ('stripe', 'usdc', 'admin', 'system', 'user')),
    reason          text,
    metadata        jsonb not null default '{}'::jsonb,
    created_at      timestamptz not null default now()
);

create index if not exists sub_events_subscription_id_idx on public.subscription_events (subscription_id);
create index if not exists sub_events_user_id_idx on public.subscription_events (user_id);
create index if not exists sub_events_created_at_idx on public.subscription_events (created_at);

-- ---------------------------------------------------------------------------
-- Payment verification history (who verified a crypto payment and why)
-- ---------------------------------------------------------------------------
create table if not exists public.payment_verifications (
    id                       uuid primary key default gen_random_uuid(),
    payment_id               uuid not null references public.payments(id) on delete cascade,
    admin_user_id            text,
    result                   text not null check (result in ('confirmed', 'rejected')),
    note                     text,
    verified_amount          integer,
    verified_transaction_hash text,
    created_at               timestamptz not null default now()
);

create index if not exists payment_verifications_payment_id_idx on public.payment_verifications (payment_id);

-- ---------------------------------------------------------------------------
-- Admin audit log (administrative / security actions, immutable)
-- ---------------------------------------------------------------------------
create table if not exists public.audit_logs (
    id            uuid primary key default gen_random_uuid(),
    admin_user_id text,
    action        text not null,
    resource_type text,
    resource_id   text,
    detail        jsonb not null default '{}'::jsonb,
    ip            text,
    created_at    timestamptz not null default now()
);

create index if not exists audit_logs_created_at_idx on public.audit_logs (created_at);
create index if not exists audit_logs_admin_idx on public.audit_logs (admin_user_id);
create index if not exists audit_logs_action_idx on public.audit_logs (action);

-- ---------------------------------------------------------------------------
-- System health / error monitoring
-- ---------------------------------------------------------------------------
create table if not exists public.system_events (
    id          uuid primary key default gen_random_uuid(),
    event_type  text not null,
    severity    text not null check (severity in ('info', 'warn', 'error')),
    status      text,
    message     text not null,
    user_id     text,
    metadata    jsonb not null default '{}'::jsonb,
    created_at  timestamptz not null default now()
);

create index if not exists system_events_created_at_idx on public.system_events (created_at);
create index if not exists system_events_severity_idx on public.system_events (severity);
create index if not exists system_events_event_type_idx on public.system_events (event_type);

-- ---------------------------------------------------------------------------
-- Stripe webhook idempotency ledger
-- ---------------------------------------------------------------------------
create table if not exists public.stripe_webhook_events (
    id              uuid primary key default gen_random_uuid(),
    stripe_event_id text not null unique,
    event_type      text not null,
    processed_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Key-value settings (admin-configurable platform settings)
-- ---------------------------------------------------------------------------
create table if not exists public.settings (
    key        text primary key,
    value      jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Immutability guards for history tables
-- ---------------------------------------------------------------------------
create or replace function public.block_history_mutation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    raise exception 'history rows are immutable';
end;
$$;

do $$
declare t text;
begin
    foreach t in array array['subscription_events', 'audit_logs', 'payment_verifications', 'stripe_webhook_events']
    loop
        execute format('drop trigger if exists %I_no_update on public.%I', t, t);
        execute format('create trigger %I_no_update before update or delete on public.%I for each row execute function public.block_history_mutation()', t, t);
    end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.plans                  enable row level security;
alter table public.subscriptions           enable row level security;
alter table public.payments                enable row level security;
alter table public.subscription_events     enable row level security;
alter table public.payment_verifications   enable row level security;
alter table public.audit_logs              enable row level security;
alter table public.system_events           enable row level security;
alter table public.stripe_webhook_events   enable row level security;
alter table public.settings                enable row level security;

-- The server (service role) performs all reads/writes.
create policy "service_role full access plans"      on public.plans                for all to service_role using (true) with check (true);
create policy "service_role full access subscriptions" on public.subscriptions     for all to service_role using (true) with check (true);
create policy "service_role full access payments"   on public.payments             for all to service_role using (true) with check (true);
create policy "service_role full access sub_events" on public.subscription_events  for all to service_role using (true) with check (true);
create policy "service_role full access verifications" on public.payment_verifications for all to service_role using (true) with check (true);
create policy "service_role full access audit"      on public.audit_logs           for all to service_role using (true) with check (true);
create policy "service_role full access system"     on public.system_events        for all to service_role using (true) with check (true);
create policy "service_role full access webhooks"   on public.stripe_webhook_events for all to service_role using (true) with check (true);
create policy "service_role full access settings"   on public.settings             for all to service_role using (true) with check (true);

-- Public, active plan prices are deliberately readable (the pricing page is a
-- public marketing surface). Everything else is denied to anon/authenticated.
create policy "public plans readable" on public.plans
    for select to anon, authenticated using (is_active = true and is_public = true);

-- Explicitly strip access from the roles that a public/publishable key maps to.
revoke all on public.plans, public.subscriptions, public.payments,
    public.subscription_events, public.payment_verifications, public.audit_logs,
    public.system_events, public.stripe_webhook_events, public.settings
    from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Seed the plans Baton sells (mirrors the historical public pricing). Prices
-- are in cents. Organization is custom-priced (contact sales).
-- ---------------------------------------------------------------------------
insert into public.plans (slug, name, description, monthly_price_cents, annual_price_cents, price_custom, currency, sort_order, is_active, is_public) values
    ('team', 'Team', 'For engineering teams that want to ship fast and stop PR stalls.', 1000, 800, false, 'USD', 10, true, true),
    ('organization', 'Organization', 'For scaling engineering organizations with compliance, unlimited repos, and priority SLAs.', 5000, 48000, false, 'USD', 20, true, true)
on conflict (slug) do update set
    monthly_price_cents = 5000,
    annual_price_cents = 48000,
    price_custom = false;