-- ============================================================================
-- Baton billing hardening (additive).
--
-- DB-level ordering constraints that the server also enforces, added after the
-- initial schema so existing environments can apply this incrementally:
--   * at most ONE open (pending / pending_verification) payment per
--     subscription: tail UDP payments and retried stripe sessions can never
--     double-book the same checkout;
--   * a few extra query indexes for the admin analytics surfaces.
-- ============================================================================

-- One open payment per subscription at a time. A completed checkout creates a
-- second row only after the first is confirmed/failed/refunded.
create unique index if not exists payments_one_open_per_subscription
    on public.payments (subscription_id)
    where status in ('pending', 'pending_verification');

-- Likely join targets for admin analytics / escalation lookups.
create index if not exists payments_plan_id_idx on public.payments (plan_id);
create index if not exists payments_paid_at_idx on public.payments (paid_at);

create index if not exists sub_events_event_type_idx on public.subscription_events (event_type);
create index if not exists sub_events_new_status_idx on public.subscription_events (new_status);

create index if not exists payment_verifications_admin_idx on public.payment_verifications (admin_user_id);
create index if not exists audit_logs_resource_idx on public.audit_logs (resource_type, resource_id);