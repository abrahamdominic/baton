-- ============================================================================
-- Checkout cancellation + admin-gifted plans.
--
-- 1. `payments.status` gains `cancelled` (a checkout abandoned before payment).
--    This closes a checkout path and lets the subscription be terminated as
--    `canceled` (see subscription-machine) so a brand-new purchase can start.
-- 2. `subscriptions.payment_provider` gains `gift` so admin-granted access is
--    clearly distinguished from paid subscriptions (no fake Stripe/USDC money).
-- 3. New `gift_grants` table records who gifted what plan to which user, for how
--    long, and which subscription row carries the entitlement.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- payments.status check → allow 'cancelled'
-- ---------------------------------------------------------------------------
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = any(con.conkey)
    where con.conrelid = 'public.payments'::regclass and con.contype = 'c' and a.attname = 'status'
  loop
    execute format('alter table public.payments drop constraint %I', c.conname);
  end loop;
end
$$;

alter table public.payments
    add constraint payments_status_check check (status in (
        'pending', 'pending_verification', 'confirmed', 'failed',
        'rejected', 'refunded', 'cancelled'
    ));

-- ---------------------------------------------------------------------------
-- subscriptions.payment_provider check → allow 'gift'
-- ---------------------------------------------------------------------------
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = any(con.conkey)
    where con.conrelid = 'public.subscriptions'::regclass and con.contype = 'c' and a.attname = 'payment_provider'
  loop
    execute format('alter table public.subscriptions drop constraint %I', c.conname);
  end loop;
end
$$;

alter table public.subscriptions
    add constraint subscriptions_payment_provider_check check (payment_provider in ('stripe', 'usdc', 'gift'));

-- ---------------------------------------------------------------------------
-- Gift grants (admin-gifted plan access ledger)
-- ---------------------------------------------------------------------------
create table if not exists public.gift_grants (
    id                uuid primary key default gen_random_uuid(),
    user_id           text not null,
    plan_id           uuid not null references public.plans(id),
    admin_user_id     text,
    duration_type     text not null check (duration_type in ('monthly', 'annual')),
    months            integer not null check (months between 1 and 120),
    note              text,
    subscription_id   uuid references public.subscriptions(id) on delete set null,
    access_started_at timestamptz not null default now(),
    access_ends_at    timestamptz,
    created_at        timestamptz not null default now()
);

create index if not exists gift_grants_user_id_idx on public.gift_grants (user_id);
create index if not exists gift_grants_access_ends_at_idx on public.gift_grants (access_ends_at);
create index if not exists gift_grants_created_at_idx on public.gift_grants (created_at);

alter table public.gift_grants enable row level security;

create policy "service_role full access gift_grants" on public.gift_grants
    for all to service_role using (true) with check (true);

revoke all on public.gift_grants from anon, authenticated;