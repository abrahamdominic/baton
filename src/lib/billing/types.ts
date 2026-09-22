/**
 * Canonical billing domain types.
 *
 * Identity note: Baton signs users in through GitHub OAuth and stores the
 * session in its own database (Prisma/Postgres). Supabase therefore does not
 * hold a *separate* user identity — `user_id` on these tables is Baton's
 * `User.id`. All access happens server-side (service role); RLS denies the
 * anon/authenticated PostgREST roles entirely.
 */

export const SUBSCRIPTION_STATUSES = [
  "none",
  "pending",
  "active",
  "active_until_period_end",
  "past_due",
  "payment_failed",
  "canceled",
  "expired",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const PAYMENT_PROVIDERS = ["stripe", "usdc"] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export const PAYMENT_TYPES = [
  "initial_subscription",
  "renewal",
  "plan_change",
  "one_time",
] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

export const PAYMENT_STATUSES = [
  "pending",
  "pending_verification",
  "confirmed",
  "failed",
  "rejected",
  "refunded",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** USD minor unit (cents) — the "major unit with 2 decimals" of a price. */
export type Cents = number;

export interface PlanRecord {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  monthly_price_cents: Cents;
  annual_price_cents: Cents;
  price_custom: boolean;
  currency: string;
  features: unknown;
  limits: unknown;
  stripe_product_id: string | null;
  stripe_monthly_price_id: string | null;
  stripe_annual_price_id: string | null;
  is_active: boolean;
  is_public: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionRecord {
  id: string;
  user_id: string;
  plan_id: string;
  status: SubscriptionStatus;
  payment_provider: PaymentProvider | null;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
  plan?: PlanRecord | null;
}

export interface PaymentRecord {
  id: string;
  user_id: string;
  subscription_id: string | null;
  plan_id: string;
  payment_provider: PaymentProvider;
  payment_type: PaymentType;
  status: PaymentStatus;
  amount: Cents;
  currency: string;
  stripe_payment_intent_id: string | null;
  stripe_checkout_session_id: string | null;
  stripe_invoice_id: string | null;
  crypto_network: string | null;
  crypto_token: string | null;
  crypto_wallet_address: string | null;
  crypto_transaction_hash: string | null;
  failure_reason: string | null;
  metadata: unknown;
  created_at: string;
  updated_at: string;
  paid_at: string | null;
  plan?: PlanRecord | null;
}

export interface SubscriptionEventRecord {
  id: string;
  subscription_id: string | null;
  user_id: string;
  event_type: string;
  previous_status: SubscriptionStatus | null;
  new_status: SubscriptionStatus | null;
  previous_plan_id: string | null;
  new_plan_id: string | null;
  payment_id: string | null;
  source: string;
  reason: string | null;
  metadata: unknown;
  created_at: string;
}

export interface Entitlement {
  /** The resolved plan slug ("free" when no paid plan is active). */
  planSlug: string;
  planName: string;
  /** true when the backend considers the user entitled to the selected plan. */
  hasPaidAccess: boolean;
  /** Live subscription row driving access (null for free). */
  subscription: SubscriptionRecord | null;
  status: SubscriptionStatus;
  /** Human label for the status, safe to display. */
  statusLabel: string;
}

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  none: "No plan",
  pending: "Pending",
  active: "Active",
  active_until_period_end: "Active until period end",
  past_due: "Past due",
  payment_failed: "Payment failed",
  canceled: "Canceled",
  expired: "Expired",
};