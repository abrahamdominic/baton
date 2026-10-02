-- ============================================================================
-- Billing production completeness (refunds, action-required, reconciliation).
--
-- The webhook lifecycle already covers checkout, activation, renewal, failed
-- payment, past-due and cancellation. Three production states had no storage at
-- all, so a correct handler could not record what it saw:
--
--  1. REFUNDS. `payments.status` could be set to 'refunded', but nothing stored
--     *which* Stripe refund it was, for how much, or whether it was partial.
--     Stripe allows several partial refunds against one charge, so a single
--     status column cannot represent the history and a full refund cannot be
--     distinguished from a 10% one. `payment_refunds` is a ledger whose financial
--     facts are immutable (see block_refund_fact_mutation below).
--
--  2. ACTION REQUIRED. Stripe reports two different "you must do something"
--     states that were previously indistinguishable from a generic failure:
--     `invoice.payment_action_required` (the saved card needs an update, e.g.
--     an expired card or a failed 3DS challenge) and a subscription sitting in
--     `incomplete` (the first payment never settled). Both mean the user must
--     act before access continues, and neither resolves by retrying on its own.
--     They need a durable flag so the dashboard can prompt the user instead of
--     silently showing a generic "payment failed".
--
--  3. RECONCILIATION. Webhooks are the primary path, but they can be dropped,
--     reordered, or lost while an endpoint is unavailable, and Stripe is the
--     authority for billing state. `billing_reconciliation_runs` records every
--     comparison pass, its outcome, and each discrepancy it found, so "local
--     state matches Stripe" is an auditable claim rather than a hope, and a
--     divergence a webhook missed is repaired on a schedule.
--
-- No destructive statements. Every object is created IF NOT EXISTS, the one new
-- constraint is attached NOT VALID so legacy rows cannot block the migration,
-- and no row is deleted or rewritten anywhere in this file.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- subscriptions: durable "the user must update their payment method" state
-- ---------------------------------------------------------------------------
alter table public.subscriptions
    add column if not exists payment_action_required boolean not null default false;
alter table public.subscriptions
    add column if not exists payment_action_reason text;

comment on column public.subscriptions.payment_action_required is
    'True when Stripe requires the customer to update their payment method (invoice.payment_action_required, or a subscription left incomplete). Cleared as soon as the invoice is paid.';
comment on column public.subscriptions.payment_action_reason is
    'Short, non-sensitive explanation of why payment_action_required was set, safe to render in the dashboard.';

-- Reconciliation selects Stripe-backed rows by this exact pairing.
create index if not exists subscriptions_stripe_reconcile_idx
    on public.subscriptions (updated_at)
    where payment_provider = 'stripe' and provider_subscription_id is not null;

-- ---------------------------------------------------------------------------
-- provider / provider-subscription-id consistency
-- ---------------------------------------------------------------------------
-- A provider subscription id only belongs on a row that is a subscription at
-- that provider. Anything else is either a bad write or a half-finished USDC
-- conversion, and both would send reconciliation to compare the wrong Stripe
-- object and "repair" the row to the wrong state.
--
-- Attached NOT VALID: the constraint is enforced for every insert and update
-- from this migration forward, but pre-existing rows are not scanned, so a
-- legacy anomaly cannot make the migration fail on production. Those rows are
-- reported by the billing reconciliation pass instead of being silently
-- tolerated, and can be cleaned up before validating:
--
--   alter table public.subscriptions validate constraint subscriptions_provider_pair_check;
alter table public.subscriptions
    drop constraint if exists subscriptions_provider_pair_check;
alter table public.subscriptions
    add constraint subscriptions_provider_pair_check check (
        provider_subscription_id is null
        or payment_provider in ('stripe', 'usdc')
    ) not valid;

do $$
declare
  bad record;
begin
  select count(*) into bad from public.subscriptions
   where provider_subscription_id is not null
     and (payment_provider is null or payment_provider not in ('stripe', 'usdc'));
  if bad > 0 then
    raise notice 'subscriptions_provider_pair_check: % pre-existing row(s) still violate the constraint and are reported by billing reconciliation', bad;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- payment_refunds (Stripe refund ledger: facts immutable, state mutable)
-- ---------------------------------------------------------------------------
create table if not exists public.payment_refunds (
    id                 uuid primary key default gen_random_uuid(),
    payment_id         uuid not null references public.payments(id) on delete cascade,
    subscription_id    uuid references public.subscriptions(id) on delete set null,
    user_id            text not null,
    stripe_refund_id   text not null unique,
    stripe_charge_id   text,
    amount             integer not null check (amount > 0),
    currency           text not null default 'USD',
    -- Stripe reports the refund state at the time of the event. A refund can
    -- still settle or fail afterwards, which is the only thing allowed to change.
    status             text not null default 'succeeded'
                       check (status in ('pending', 'succeeded', 'failed', 'cancelled')),
    reason             text,
    -- True once this refund actually cost the user access.
    access_revoked     boolean not null default false,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);

create index if not exists payment_refunds_payment_id_idx on public.payment_refunds (payment_id);
create index if not exists payment_refunds_user_id_idx on public.payment_refunds (user_id);
create index if not exists payment_refunds_created_at_idx on public.payment_refunds (created_at);

-- The financial facts of a refund can never be rewritten: which Stripe object
-- was refunded, for how much, in which currency, when, and for whom. Only the
-- processing state (status) and whether access was revoked may move afterwards,
-- because Stripe can move a refund from pending to succeeded after the fact and
-- the ledger must be able to follow it.
--
-- This is deliberately weaker than `block_history_mutation` (which forbids all
-- updates), because a refund row has to be correctable in one specific way.
create or replace function public.block_refund_fact_mutation()
returns trigger
language plpgsql
as $$
begin
  if (new.payment_id, new.subscription_id, new.user_id, new.stripe_refund_id,
      new.stripe_charge_id, new.amount, new.currency, new.reason, new.created_at)
     is distinct from
     (old.payment_id, old.subscription_id, old.user_id, old.stripe_refund_id,
      old.stripe_charge_id, old.amount, old.currency, old.reason, old.created_at)
  then
    raise exception 'payment_refunds financial facts are immutable (refund %)', old.stripe_refund_id
      using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.block_refund_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'payment_refunds rows cannot be deleted (refund %)', old.stripe_refund_id
    using errcode = '23514';
end;
$$;

drop trigger if exists payment_refunds_immutable_facts on public.payment_refunds;
create trigger payment_refunds_immutable_facts
  before update on public.payment_refunds
  for each row execute function public.block_refund_fact_mutation();

drop trigger if exists payment_refunds_no_delete on public.payment_refunds;
create trigger payment_refunds_no_delete
  before delete on public.payment_refunds
  for each row execute function public.block_refund_delete();

-- ---------------------------------------------------------------------------
-- billing_reconciliation_runs (evidence that local state matches Stripe)
-- ---------------------------------------------------------------------------
create table if not exists public.billing_reconciliation_runs (
    id                 uuid primary key default gen_random_uuid(),
    trigger            text not null default 'cron' check (trigger in ('cron', 'manual', 'admin')),
    status             text not null default 'running'
                       check (status in ('running', 'ok', 'discrepancies', 'failed')),
    -- Rows actually compared against Stripe. `scanned` is written up front so a
    -- pass killed halfway is visibly partial instead of looking complete.
    scanned            integer not null default 0,
    reconciled         integer not null default 0,
    repaired           integer not null default 0,
    failed             integer not null default 0,
    discrepancies      jsonb not null default '[]'::jsonb,
    error_message      text,
    started_at         timestamptz not null default now(),
    finished_at        timestamptz
);

create index if not exists billing_recon_runs_started_at_idx
    on public.billing_reconciliation_runs (started_at desc);

-- Single-flight. Without this, a slow pass and the next scheduled run both
-- repair the same rows concurrently and write two conflicting transitions.
create unique index if not exists billing_recon_single_flight_idx
    on public.billing_reconciliation_runs ((true))
    where status = 'running';

-- ---------------------------------------------------------------------------
-- RLS (service role only, matching every other billing table)
-- ---------------------------------------------------------------------------
alter table public.payment_refunds enable row level security;

drop policy if exists "service_role full access payment_refunds" on public.payment_refunds;
create policy "service_role full access payment_refunds" on public.payment_refunds
    for all to service_role using (true) with check (true);

revoke all on public.payment_refunds from anon, authenticated;

alter table public.billing_reconciliation_runs enable row level security;

drop policy if exists "service_role full access billing_reconciliation_runs" on public.billing_reconciliation_runs;
create policy "service_role full access billing_reconciliation_runs" on public.billing_reconciliation_runs
    for all to service_role using (true) with check (true);

revoke all on public.billing_reconciliation_runs from anon, authenticated;
