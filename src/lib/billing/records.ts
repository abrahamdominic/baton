import type { PlanRecord, SubscriptionRecord, PaymentRecord, SubscriptionEventRecord } from "./types";

export type Row = Record<string, unknown>;

export function planFromRow(row: Row): PlanRecord {
  return {
    id: str(row.id),
    slug: str(row.slug),
    name: str(row.name),
    description: strOrNull(row.description),
    monthly_price_cents: num(row.monthly_price_cents),
    annual_price_cents: num(row.annual_price_cents),
    price_custom: bool(row.price_custom),
    currency: strOr(row.currency, "USD"),
    features: row.features ?? [],
    limits: row.limits ?? {},
    stripe_product_id: strOrNull(row.stripe_product_id),
    stripe_monthly_price_id: strOrNull(row.stripe_monthly_price_id),
    stripe_annual_price_id: strOrNull(row.stripe_annual_price_id),
    is_active: bool(row.is_active),
    is_public: bool(row.is_public),
    sort_order: num(row.sort_order),
    created_at: str(row.created_at),
    updated_at: str(row.updated_at),
  };
}

export function subscriptionFromRow(row: Row, plan?: PlanRecord | null): SubscriptionRecord {
  return {
    id: str(row.id),
    user_id: str(row.user_id),
    plan_id: str(row.plan_id),
    status: (row.status as SubscriptionRecord["status"]) ?? "none",
    payment_provider: (row.payment_provider as SubscriptionRecord["payment_provider"]) ?? null,
    provider_customer_id: strOrNull(row.provider_customer_id),
    provider_subscription_id: strOrNull(row.provider_subscription_id),
    current_period_start: strOrNull(row.current_period_start),
    current_period_end: strOrNull(row.current_period_end),
    cancel_at_period_end: bool(row.cancel_at_period_end),
    canceled_at: strOrNull(row.canceled_at),
    started_at: strOrNull(row.started_at),
    ended_at: strOrNull(row.ended_at),
    created_at: str(row.created_at),
    updated_at: str(row.updated_at),
    plan: plan ?? undefined,
  };
}

export function paymentFromRow(row: Row, plan?: PlanRecord | null): PaymentRecord {
  return {
    id: str(row.id),
    user_id: str(row.user_id),
    subscription_id: strOrNull(row.subscription_id),
    plan_id: str(row.plan_id),
    payment_provider: (row.payment_provider as PaymentRecord["payment_provider"]) ?? "usdc",
    payment_type: (row.payment_type as PaymentRecord["payment_type"]) ?? "initial_subscription",
    status: (row.status as PaymentRecord["status"]) ?? "pending",
    amount: num(row.amount),
    currency: strOr(row.currency, "USD"),
    stripe_payment_intent_id: strOrNull(row.stripe_payment_intent_id),
    stripe_checkout_session_id: strOrNull(row.stripe_checkout_session_id),
    stripe_invoice_id: strOrNull(row.stripe_invoice_id),
    crypto_network: strOrNull(row.crypto_network),
    crypto_token: strOrNull(row.crypto_token),
    crypto_wallet_address: strOrNull(row.crypto_wallet_address),
    crypto_transaction_hash: strOrNull(row.crypto_transaction_hash),
    failure_reason: strOrNull(row.failure_reason),
    metadata: row.metadata ?? {},
    created_at: str(row.created_at),
    updated_at: str(row.updated_at),
    paid_at: strOrNull(row.paid_at),
    plan: plan ?? undefined,
  };
}

export function eventFromRow(row: Row): SubscriptionEventRecord {
  return {
    id: str(row.id),
    subscription_id: strOrNull(row.subscription_id),
    user_id: str(row.user_id),
    event_type: str(row.event_type),
    previous_status: (row.previous_status as SubscriptionEventRecord["previous_status"]) ?? null,
    new_status: (row.new_status as SubscriptionEventRecord["new_status"]) ?? null,
    previous_plan_id: strOrNull(row.previous_plan_id),
    new_plan_id: strOrNull(row.new_plan_id),
    payment_id: strOrNull(row.payment_id),
    source: strOr(row.source, "system"),
    reason: strOrNull(row.reason),
    metadata: row.metadata ?? {},
    created_at: str(row.created_at),
  };
}

function str(v: unknown): string {
  if (typeof v === "string") return v;
  throw new Error("invalid row: expected string");
}
function strOr(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}
function strOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}
function bool(v: unknown): boolean {
  return v === true || v === "true" || v === 1;
}