-- ============================================================================
-- Payment attribution integrity, subscription write races, and trigger
-- function search_path pinning.
--
-- Four independent problems, all fixed here:
--
--  1. USDC ORDERS WERE NOT ATTRIBUTABLE ON-CHAIN. Base USDC transfers carry no
--     memo and there is one shared receiving wallet, so the only thing that
--     distinguishes "this transfer paid for my order" from "this transfer
--     happened to be visible on chain" was the amount matching the plan price.
--     Every order for the same plan therefore had the *same* expected figure,
--     which means any observer of a public transfer could submit its hash
--     against their own pending order and have it verified: the transfer is
--     credited to the attacker and the real payer is left waiting on a hash
--     that is now recorded as used.
--
--     `crypto_expected_amount_onchain` stores the exact on-chain figure an
--     order must be paid with: the plan price plus a per-order sub-cent nonce
--     (1..9999 of the 6 decimals USDC has below a cent). Matching on the exact
--     amount is what makes the transfer attributable to one order and no
--     other. The credited plan price is unchanged — the dust is never billed.
--
--  2. TWO OPEN USDC ORDERS COULD CLAIM THE SAME FIGURE. The nonce is drawn from
--     a 10,000-wide space, so a collision is possible, and a duplicate figure
--     would re-open exactly the ambiguity this column exists to remove. The
--     unique index makes the database the arbiter, and the insert retries with
--     a fresh nonce.
--
--  3. SUBSCRIPTION TRANSITIONS HAD NO COMPARE-AND-SET. The state machine was
--     validated in the application against a row it had read, then written
--     back unconditionally, so two webhooks (or a webhook and a user action)
--     that read the same status both validated and both wrote. A renewal and a
--     cancellation landing in the same window could interleave into a state the
--     machine would have rejected. The fix is the `.eq("status", observed)`
--     predicate in `transitionSubscription`; the partial unique index below is
--     the matching guarantee that a user cannot accumulate open checkouts at
--     all.
--
--  4. TRIGGER FUNCTIONS RAN WITH A CALLER-CONTROLLED search_path.
--     `block_refund_fact_mutation` and `block_refund_delete` are SECURITY
--     DEFINER and were created without `set search_path`, so the name
--     resolution inside them depended on the session's search_path — a caller
--     who can influence it can shadow `now()` or any other referenced name
--     inside a definer-privileged function. Re-created with the path pinned.
--
-- No destructive statements: no row is deleted or rewritten, and every DDL
-- statement is `IF NOT EXISTS` / `OR REPLACE`. The one index that could conflict
-- with existing data — one open checkout per user — is preceded by a duplicate
-- check that aborts with the offending user ids and the query to inspect them,
-- rather than guessing which of somebody's payment rows may be discarded.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 + 2. Per-order exact on-chain deposit amount
-- ---------------------------------------------------------------------------
alter table public.payments
    add column if not exists crypto_expected_amount_onchain text;

comment on column public.payments.crypto_expected_amount_onchain is
    'Exact on-chain USDC amount (integer 6-decimal base units) this order must be paid with: plan price plus a unique sub-cent nonce. Verification matches this exactly, which is what binds a transfer to one order.';

-- A stored figure must be a plain non-negative integer, never a float, a
-- decimal string, or anything with a sign. The verifier parses this column
-- directly as a bigint.
alter table public.payments
    drop constraint if exists payments_crypto_expected_amount_onchain_format;
alter table public.payments
    add constraint payments_crypto_expected_amount_onchain_format
    check (
        crypto_expected_amount_onchain is null
        or crypto_expected_amount_onchain ~ '^[0-9]{1,24}$'
    ) not valid;

-- Only open orders need a distinct figure. Once an order is terminal its figure
-- can never be claimed again — the transaction hash is what excludes reuse at
-- that point — so keeping the index scoped to open rows preserves the
-- guarantee without turning a busy table's historical rows into a constraint
-- that must be maintained forever.
--
-- Building this index cannot conflict with anything: the column is created empty
-- in the statement above, and NULLs are excluded by the predicate, so every
-- existing row is outside the index.
create unique index if not exists payments_one_open_usdc_amount_idx
    on public.payments (crypto_expected_amount_onchain)
    where crypto_expected_amount_onchain is not null
      and status in ('pending', 'pending_verification');

-- ---------------------------------------------------------------------------
-- 3. One open checkout per user
-- ---------------------------------------------------------------------------
-- The application already reuses the pending row across retries (see
-- `prepareSubscriptionForCheckout` / `createOrReuseOpenPayment`), so a second
-- open row for the same user is always a lost race rather than an intent.
--
-- A partial unique INDEX is the mechanism: `unique (user_id) where status =
-- 'pending'` as a table constraint cannot be added `NOT VALID`, so an
-- environment holding duplicates would abort the migration at the index build
-- with PostgreSQL's own "could not create unique index" message and no
-- indication of which rows to look at. The duplicate check therefore runs
-- first and names the affected users.
--
-- Duplicates are NOT collapsed automatically. Pending subscriptions are money
-- rows: `payments` references them, and silently deleting one to satisfy an
-- index would either fail on the foreign key or leave a payment pointing at a
-- row that no longer exists. Resolving them is an operator decision, so the
-- migration stops with enough information to make it. Every write after this
-- point is enforced, and the historical rows cannot create a new race.
do $$
declare
  dupes text;
begin
  select string_agg(d.user_id, ', ' order by d.user_id)
  into dupes
  from (
    select user_id
    from public.subscriptions
    where status = 'pending'
    group by user_id
    having count(*) > 1
  ) d;

  if dupes is not null then
    raise exception using
      errcode = 'check_violation',
      message = 'cannot enforce one open checkout per user: these user_ids have more than one pending subscription (' || dupes || ')',
      detail = 'Review each user''s pending rows and cancel or delete the abandoned one, keeping the row that matches their live checkout. No rows were changed. Re-run the migration afterwards.',
      hint = 'select id, user_id, plan_id, created_at, updated_at from public.subscriptions where status = ''pending'' and user_id in (select user_id from public.subscriptions where status = ''pending'' group by user_id having count(*) > 1) order by user_id, updated_at desc;';
  end if;
end;
$$;

create unique index if not exists subscriptions_one_open_per_user_idx
    on public.subscriptions (user_id)
    where status = 'pending';

-- ---------------------------------------------------------------------------
-- 4. Pin search_path on the SECURITY DEFINER refund triggers
-- ---------------------------------------------------------------------------
-- Same bodies as 0012, re-created with `set search_path = public` so resolution
-- cannot be steered by the caller's session state.
create or replace function public.block_refund_fact_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
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
security definer
set search_path = public
as $$
begin
  raise exception 'payment_refunds rows cannot be deleted (refund %)', old.stripe_refund_id
    using errcode = '23514';
end;
$$;

-- ---------------------------------------------------------------------------
-- Default privileges: no ambient access to future billing tables
-- ---------------------------------------------------------------------------
-- A table created later would otherwise inherit PUBLIC's default table
-- privileges, so every hardening step in this file (RLS, revoked grants) has to
-- be remembered again for the next table. Pinning the default for the app roles
-- makes forgetting impossible.
alter default privileges in schema public
    revoke all on tables from anon, authenticated;
alter default privileges in schema public
    revoke all on functions from public;
