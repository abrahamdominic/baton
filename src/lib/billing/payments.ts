import "server-only";
import { getAdminClient } from "@/lib/supabase/client";
import { getPlanById } from "./plans";
import {
  getCurrentSubscription,
  getSubscriptionById,
  activateSubscription,
  renewSubscription,
  markSubscriptionPaymentFailed,
} from "./subscriptions";
import { isValidTransactionHash, verifyUsdcTransaction } from "./usdc";
import { usdcSettings } from "@/lib/config";
import { paymentFromRow, type Row } from "./records";
import { BillingInputError, BackendNotConfiguredError } from "./errors";
import { recordSystemEvent } from "./system-events";
import type { Cents, PaymentProvider, PaymentRecord, PaymentStatus, PaymentType } from "./types";

/**
 * Payment service: records payment attempts. Payments are separate from
 * subscriptions: a confirmed payment only entitles a user after the server
 * activates the subscription (see verifyUsdcPaymentNow / Stripe webhooks).
 */

export interface CreatePaymentInput {
  userId: string;
  subscriptionId: string | null;
  planId: string;
  provider: PaymentProvider;
  paymentType: PaymentType;
  status: PaymentStatus;
  amount: Cents;
  currency: string;
  metadata?: Record<string, unknown>;
  stripeCheckoutSessionId?: string | null;
  stripePaymentIntentId?: string | null;
  stripeInvoiceId?: string | null;
  cryptoNetwork?: string | null;
  cryptoToken?: string | null;
  cryptoWalletAddress?: string | null;
}

export async function createPayment(input: CreatePaymentInput): Promise<PaymentRecord> {
  const sb = getAdminClient();
  const { data, error } = await sb
    .from("payments")
    .insert({
      user_id: input.userId,
      subscription_id: input.subscriptionId,
      plan_id: input.planId,
      payment_provider: input.provider,
      payment_type: input.paymentType,
      status: input.status,
      amount: input.amount,
      currency: input.currency,
      metadata: input.metadata ?? {},
      stripe_checkout_session_id: input.stripeCheckoutSessionId ?? null,
      stripe_payment_intent_id: input.stripePaymentIntentId ?? null,
      stripe_invoice_id: input.stripeInvoiceId ?? null,
      crypto_network: input.cryptoNetwork ?? null,
      crypto_token: input.cryptoToken ?? null,
      crypto_wallet_address: input.cryptoWalletAddress ?? null,
    })
    .select("*")
    .single();
  if (error) throw new Error(`payments.create failed: ${error.message}`);
  return paymentFromRow(data as Row);
}

/** Start a USDC order: exact amount from the plan, wallet from server env. */
export async function createUsdcPayment(opts: {
  userId: string;
  subscriptionId: string | null;
  planId: string;
  amount: Cents;
  interval: "monthly" | "annual";
  paymentType?: PaymentType;
}): Promise<PaymentRecord> {
  const settings = usdcSettings();
  if (!settings.walletAddress) {
    throw new BackendNotConfiguredError(
      "USDC payments are not configured. Set USDC_PAYMENT_WALLET_ADDRESS before offering crypto checkout.",
    );
  }
  return createOrReuseOpenPayment({
    userId: opts.userId,
    subscriptionId: opts.subscriptionId,
    planId: opts.planId,
    provider: "usdc",
    paymentType: opts.paymentType ?? "initial_subscription",
    status: "pending",
    amount: opts.amount,
    currency: "USDC",
    metadata: { interval: opts.interval },
    cryptoNetwork: settings.network,
    cryptoToken: settings.token,
    cryptoWalletAddress: settings.walletAddress,
  });
}

export async function createStripePayment(opts: {
  userId: string;
  subscriptionId: string | null;
  planId: string;
  amount: Cents;
  interval: "monthly" | "annual";
  checkoutSessionId?: string;
}): Promise<PaymentRecord> {
  return createOrReuseOpenPayment({
    userId: opts.userId,
    subscriptionId: opts.subscriptionId,
    planId: opts.planId,
    provider: "stripe",
    paymentType: "initial_subscription",
    status: "pending",
    amount: opts.amount,
    currency: "USD",
    metadata: { interval: opts.interval },
    stripeCheckoutSessionId: opts.checkoutSessionId ?? null,
  });
}

/**
 * The open (pending / pending_verification) payment for a subscription, if any.
 * `payments_one_open_per_subscription` guarantees at most one row matches.
 */
export async function findOpenPaymentForSubscription(
  subscriptionId: string | null,
): Promise<PaymentRecord | null> {
  if (!subscriptionId) return null;
  const sb = getAdminClient();
  const { data, error } = await sb
    .from("payments")
    .select("*")
    .eq("subscription_id", subscriptionId)
    .in("status", ["pending", "pending_verification"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`payments.find-open failed: ${error.message}`);
  if (!data) return null;
  return paymentFromRow(data as Row);
}

/**
 * Create (or reuse) the open checkout payment for a subscription. Retries and
 * manual USDC renewals reuse the SAME subscription row, and the unique partial
 * index `payments_one_open_per_subscription` only allows one open payment per
 * subscription — so a second insert would fail. This looks for an existing open
 * payment on the subscription first and patches it to the new amount/interval
 * instead of inserting a duplicate.
 */
async function createOrReuseOpenPayment(
  input: CreatePaymentInput,
): Promise<PaymentRecord> {
  const existing = await findOpenPaymentForSubscription(input.subscriptionId);
  if (existing) {
    const sb = getAdminClient();
    const { data, error } = await sb
      .from("payments")
      .update({
        plan_id: input.planId,
        payment_provider: input.provider,
        payment_type: input.paymentType,
        amount: input.amount,
        currency: input.currency,
        metadata: input.metadata ?? existing.metadata,
        crypto_network: input.cryptoNetwork ?? null,
        crypto_token: input.cryptoToken ?? null,
        crypto_wallet_address: input.cryptoWalletAddress ?? null,
        crypto_transaction_hash: null,
        stripe_checkout_session_id: input.stripeCheckoutSessionId ?? null,
        stripe_payment_intent_id: input.stripePaymentIntentId ?? null,
        stripe_invoice_id: input.stripeInvoiceId ?? null,
        failure_reason: null,
        paid_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw new Error(`payments.reuse-failed: ${error.message}`);
    return paymentFromRow(data as Row);
  }
  return createPayment(input);
}

export async function getPaymentById(id: string): Promise<PaymentRecord | null> {
  const sb = getAdminClient();
  const { data, error } = await sb.from("payments").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`payments.get failed: ${error.message}`);
  if (!data) return null;
  const payment = paymentFromRow(data as Row);
  payment.plan = await getPlanById(payment.plan_id);
  return payment;
}

export async function getPaymentByCheckoutSessionId(sessionId: string): Promise<PaymentRecord | null> {
  const sb = getAdminClient();
  const { data, error } = await sb
    .from("payments")
    .select("*")
    .eq("stripe_checkout_session_id", sessionId)
    .maybeSingle();
  if (error) throw new Error(`payments.get-by-session failed: ${error.message}`);
  if (!data) return null;
  const payment = paymentFromRow(data as Row);
  payment.plan = await getPlanById(payment.plan_id);
  return payment;
}

export async function getPaymentByTxHash(txHash: string): Promise<PaymentRecord | null> {
  const sb = getAdminClient();
  const { data, error } = await sb
    .from("payments")
    .select("*")
    .eq("crypto_transaction_hash", txHash)
    .maybeSingle();
  if (error) throw new Error(`payments.get-by-hash failed: ${error.message}`);
  if (!data) return null;
  const payment = paymentFromRow(data as Row);
  payment.plan = await getPlanById(payment.plan_id);
  return payment;
}

export async function listPaymentsForUser(userId: string, limit = 50) {
  const sb = getAdminClient();
  const { data, error } = await sb
    .from("payments")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`payments.list failed: ${error.message}`);
  return Promise.all(
    (data ?? []).map(async (r) => {
      const p = paymentFromRow(r as Row);
      p.plan = await getPlanById(p.plan_id);
      return p;
    }),
  );
}

// ---------------------------------------------------------------------------
// Status mutations (server-only, never exposed to the client)
// ---------------------------------------------------------------------------

export async function patchPayment(paymentId: string, patch: Row = {}): Promise<PaymentRecord> {
  const sb = getAdminClient();
  const { data, error } = await sb
    .from("payments")
    .update({ updated_at: new Date().toISOString(), ...patch })
    .eq("id", paymentId)
    .select("*")
    .single();
  if (error) throw new Error(`payments.patch failed: ${error.message}`);
  return paymentFromRow(data as Row);
}

async function setPaymentStatus(
  paymentId: string,
  status: PaymentStatus,
  patch: Row = {},
): Promise<PaymentRecord> {
  const sb = getAdminClient();
  const { data, error } = await sb
    .from("payments")
    .update({ status, updated_at: new Date().toISOString(), ...patch })
    .eq("id", paymentId)
    .select("*")
    .single();
  if (error) throw new Error(`payments.status failed: ${error.message}`);
  return paymentFromRow(data as Row);
}

/**
 * Atomically mark a payment confirmed. The conditional update only matches
 * `pending` / `pending_verification`, so a concurrent cancellation can never
 * double-confirm and a double-delivered webhook can never double-confirm.
 *
 * When zero rows match, the payment was already moved out of the open states
 * by somebody else (e.g. the user cancelled the checkout while the webhook was
 * in flight). We re-read and return the CURRENT row: callers MUST only act on
 * the payment when `status === "confirmed"`.
 */
export async function confirmPayment(paymentId: string): Promise<PaymentRecord> {
  const sb = getAdminClient();
  const { data, error } = await sb
    .from("payments")
    .update({ status: "confirmed", paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", paymentId)
    .in("status", ["pending", "pending_verification"])
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`payments.confirm failed: ${error.message}`);
  if (data) return paymentFromRow(data as Row);
  // Someone moved the payment first. Return its current state so callers can
  // decide (idempotent re-delivery → re-read confirmed; user cancellation →
  // re-read cancelled; a failed/rejected attempt never confirms).
  const current = await getPaymentById(paymentId);
  if (!current) throw new Error("payments.confirm missing row");
  return current;
}

/**
 * Atomically cancel a checkout payment (only from the open states). Returns the
 * cancelled row when the cancel won the race, otherwise the current row:
 *  - confirmed  → the customer paid; the checkout can NOT be cancelled.
 *  - already cancelled → no-op (returns the cancelled row after no matching).
 *  - failed/rejected/refunded → already closed, cancel is a no-op (returns row).
 */
export async function cancelCheckoutPayment(paymentId: string): Promise<PaymentRecord | null> {
  const sb = getAdminClient();
  const { data, error } = await sb
    .from("payments")
    .update({
      status: "cancelled",
      failure_reason: "checkout cancelled by user",
      updated_at: new Date().toISOString(),
    })
    .eq("id", paymentId)
    .in("status", ["pending", "pending_verification"])
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`payments.cancel failed: ${error.message}`);
  if (data) return paymentFromRow(data as Row);
  const current = await getPaymentById(paymentId);
  return current;
}

export async function failPayment(paymentId: string, reason: string): Promise<PaymentRecord> {
  return setPaymentStatus(paymentId, "failed", { failure_reason: reason.slice(0, 300) });
}

export async function rejectPayment(paymentId: string, reason: string): Promise<PaymentRecord> {
  return setPaymentStatus(paymentId, "rejected", { failure_reason: reason.slice(0, 300) });
}

export async function refundPayment(paymentId: string): Promise<PaymentRecord> {
  return setPaymentStatus(paymentId, "refunded");
}

/** Insert a payment verification record (admin manual verification history). */
export async function recordPaymentVerification(opts: {
  paymentId: string;
  adminUserId: string | null;
  result: "confirmed" | "rejected";
  note?: string | null;
  verifiedAmount?: number | null;
  verifiedTransactionHash?: string | null;
}): Promise<void> {
  const sb = getAdminClient();
  await sb.from("payment_verifications").insert({
    payment_id: opts.paymentId,
    admin_user_id: opts.adminUserId,
    result: opts.result,
    note: opts.note ?? null,
    verified_amount: opts.verifiedAmount ?? null,
    verified_transaction_hash: opts.verifiedTransactionHash ?? null,
  });
}

// ---------------------------------------------------------------------------
// USDC: transaction-hash submission + verification
// ---------------------------------------------------------------------------

export interface SubmitTxHashResult {
  payment: PaymentRecord;
  verified: boolean;
  code: string | null;
}

/**
 * Reserve a submitted transaction hash on a pending USDC payment. The hash is
 * validated for shape, the payment must belong to the caller and be pending,
 * and duplicate hashes are rejected (unique constraint at the DB too).
 */
export async function submitUsdcTransactionHash(opts: {
  paymentId: string;
  userId: string;
  transactionHash: string;
}): Promise<SubmitTxHashResult> {
  const txHash = opts.transactionHash.trim();
  if (!isValidTransactionHash(txHash)) {
    throw new BillingInputError(
      "That doesn’t look like a valid Base transaction hash. It should start with 0x followed by 64 hex characters.",
    );
  }

  const payment = await getPaymentById(opts.paymentId);
  if (!payment) throw new BillingInputError("Payment not found.");
  if (payment.user_id !== opts.userId) throw new BillingInputError("Payment not found.");
  if (payment.payment_provider !== "usdc") throw new BillingInputError("This payment is not a USDC payment.");
  if (payment.status === "confirmed") {
    return { payment, verified: true, code: null };
  }
  if (payment.status !== "pending") {
    throw new BillingInputError(
      payment.status === "pending_verification"
        ? "This payment is already pending verification."
        : "This payment can no longer be updated.",
    );
  }

  const existing = await getPaymentByTxHash(txHash);
  if (existing && existing.id !== payment.id) {
    throw new BillingInputError(
      "This transaction hash has already been used for a Baton payment and cannot be reused.",
    );
  }

  await setPaymentStatus(payment.id, "pending_verification", {
    crypto_transaction_hash: txHash,
  });
  return { payment, verified: false, code: null };
}

/**
 * Apply a confirmed USDC payment to its subscription. A verified payment on a
 * brand-new (or plan-changed `pending`) subscription activates it; a verified
 * payment on an already-live subscription extends it (manual USDC renewal,
 * nk.md §9). The subscription transition itself remains guarded.
 */
export async function applyUsdcPaymentToSubscription(payment: {
  subscription_id: string | null;
  plan_id: string;
  id: string;
  metadata: unknown;
}): Promise<void> {
  if (!payment.subscription_id) return;
  const sub = await getSubscriptionById(payment.subscription_id);
  const { start, end } = periodForInterval(intervalOf(payment));
  const isRenewal = sub !== null && ["active", "active_until_period_end", "past_due"].includes(sub.status);
  if (isRenewal) {
    await renewSubscription(payment.subscription_id, {
      source: "usdc",
      paymentId: payment.id,
      currentPeriodStart: start,
      currentPeriodEnd: end,
    });
  } else {
    await activateSubscription(payment.subscription_id, {
      source: "usdc",
      paymentId: payment.id,
      planId: payment.plan_id,
      currentPeriodStart: start,
      currentPeriodEnd: end,
    });
  }
}

/**
 * Mark a subscription `payment_failed` after a rejected USDC payment, but only
 * when the subscription is actually waiting on this payment (pending rows from
 * a first purchase or plan change). Rejecting a manual renewal payment must not
 * yank access from a live subscription: the user keeps access until period end.
 */
async function failSubscriptionOnRejectedPayment(payment: { subscription_id: string | null; id: string }, reason: string) {
  if (!payment.subscription_id) return;
  const sub = await getSubscriptionById(payment.subscription_id);
  if (!sub || (sub.status !== "pending" && sub.status !== "payment_failed")) return;
  await markSubscriptionPaymentFailed(payment.subscription_id, {
    source: "usdc",
    reason,
    paymentId: payment.id,
  });
}

export type UsdcVerifyOutcome =
  | { ok: true; payment: PaymentRecord; code: "verified" | "already_confirmed" }
  | { ok: false; code: string; detail?: string; payment: PaymentRecord };

/**
 * Auto-verify a pending_verification USDC payment on-chain (Base JSON-RPC).
 * - Hard mismatches (wrong token/net/recipient/amount/reverted) → payment
 *   rejected + subscription payment_failed.
 * - Soft conditions (RPC unavailable, not yet mined, low finality) → stays
 *   pending_verification for an administrator to review manually.
 * Returns a code the UI/admin can present safely.
 */
export async function verifyUsdcPaymentNow(paymentId: string): Promise<UsdcVerifyOutcome> {
  const payment = await getPaymentById(paymentId);
  if (!payment) throw new BillingInputError("Payment not found.");
  if (payment.payment_provider !== "usdc") {
    throw new BillingInputError("This payment is not a USDC payment.");
  }
  if (payment.status === "confirmed") {
    return { ok: true, payment, code: "already_confirmed" };
  }
  if (payment.status !== "pending_verification" || !payment.crypto_transaction_hash) {
    throw new BillingInputError("Payment is not awaiting verification.");
  }

  const settings = usdcSettings();
  if (!settings.walletAddress) {
    throw new BackendNotConfiguredError("USDC receiving wallet is not configured.");
  }

  const result = await verifyUsdcTransaction(settings, payment.crypto_transaction_hash, payment.amount);

  if (result.ok) {
    // Atomic claim: confirmPayment only matches pending/pending_verification,
    // so a concurrent verification can never double-confirm (and therefore
    // never double-extend) a subscription.
    const confirmed = await confirmPayment(payment.id);
    if (confirmed.status !== "confirmed") {
      // The user cancelled the checkout while verification was in flight. The
      // funds may exist on-chain, but access is never granted from a cancelled
      // payment; the user reaches out to support for the settlement.
      await recordSystemEvent({
        eventType: "usdc_payment_cancelled",
        severity: "warn",
        status: "cancelled",
        message: `USDC payment ${payment.id} was cancelled before verification completed.`,
        userId: payment.user_id,
        metadata: { paymentId: payment.id, paymentStatus: confirmed.status },
      });
      return {
        ok: false,
        code: "cancelled",
        detail: "This payment was cancelled before it could be verified.",
        payment: confirmed,
      };
    }
    await applyUsdcPaymentToSubscription(payment);
    await recordSystemEvent({
      eventType: "usdc_payment_verified",
      severity: "info",
      status: "ok",
      message: `USDC payment ${payment.id} verified on-chain`,
      userId: payment.user_id,
      metadata: { paymentId: payment.id, confirmations: result.confirmations },
    });
    return { ok: true, payment: confirmed, code: "verified" };
  }

  const soft = result.code === "rpc_unavailable" || result.code === "not_mined" || result.code === "insufficient_finality";
  if (soft) {
    await recordSystemEvent({
      eventType: "usdc_verification_pending",
      severity: "warn",
      status: "pending",
      message: `USDC payment ${payment.id}: ${result.code}`,
      userId: payment.user_id,
      metadata: { paymentId: payment.id, code: result.code },
    });
    return { ok: false, code: result.code, detail: result.detail, payment };
  }

  // Hard rejection: never activate the subscription.
  const rejected = await rejectPayment(payment.id, result.code);
  await failSubscriptionOnRejectedPayment(payment, result.code);
  await recordSystemEvent({
    eventType: "usdc_payment_rejected",
    severity: "warn",
    status: "rejected",
    message: `USDC payment ${payment.id} rejected: ${result.code}`,
    userId: payment.user_id,
    metadata: { paymentId: payment.id, code: result.code },
  });
  return { ok: false, code: result.code, detail: result.detail, payment: rejected };
}

/** Manual admin verification (confirmed/rejected) with audit trail. */
export async function adminVerifyPayment(opts: {
  paymentId: string;
  adminUserId: string | null;
  decision: "confirmed" | "rejected";
  note?: string;
}): Promise<PaymentRecord> {
  const payment = await getPaymentById(opts.paymentId);
  if (!payment) throw new BillingInputError("Payment not found.");
  if (payment.payment_provider !== "usdc") {
    throw new BillingInputError("Only USDC payments support manual verification.");
  }
  if (payment.status !== "pending" && payment.status !== "pending_verification") {
    throw new BillingInputError(
      payment.status === "confirmed"
        ? "This payment is already confirmed."
        : "This payment can no longer be reviewed.",
    );
  }

  await recordPaymentVerification({
    paymentId: payment.id,
    adminUserId: opts.adminUserId,
    result: opts.decision,
    note: opts.note ?? null,
    verifiedAmount: payment.amount,
    verifiedTransactionHash: payment.crypto_transaction_hash,
  });

  if (opts.decision === "confirmed") {
    const confirmed = await confirmPayment(payment.id);
    if (confirmed.status !== "confirmed") {
      // A concurrent user cancellation (or terminal state) won the race.
      throw new BillingInputError("This payment can no longer be confirmed.");
    }
    await applyUsdcPaymentToSubscription(payment);
    return confirmed;
  }

  const rejected = await rejectPayment(payment.id, "rejected by administrator");
  await failSubscriptionOnRejectedPayment(payment, "rejected by administrator");
  return rejected;
}

export function intervalOf(payment: Pick<PaymentRecord, "metadata">): "monthly" | "annual" {
  const meta = (payment.metadata ?? {}) as { interval?: string };
  return meta.interval === "annual" ? "annual" : "monthly";
}

export function periodForInterval(interval: "monthly" | "annual", now = new Date()) {
  const start = now.toISOString();
  const end = new Date(now);
  if (interval === "annual") end.setUTCFullYear(end.getUTCFullYear() + 1);
  else end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end: end.toISOString() };
}

// ---------------------------------------------------------------------------
// Admin list with pagination + filters
// ---------------------------------------------------------------------------

export interface AdminPaymentQuery {
  limit?: number;
  offset?: number;
  status?: PaymentStatus | null;
  provider?: PaymentProvider | null;
  search?: string | null;
}

export async function listPaymentsAdmin(query: AdminPaymentQuery = {}) {
  const sb = getAdminClient();
  const limit = Math.min(100, query.limit ?? 25);
  let q = sb
    .from("payments")
    .select("*")
    .order("created_at", { ascending: false })
    .range(query.offset ?? 0, (query.offset ?? 0) + limit - 1);
  if (query.status) q = q.eq("status", query.status);
  if (query.provider) q = q.eq("payment_provider", query.provider);
  if (query.search) {
    q = q.or(`crypto_transaction_hash.ilike.%${query.search}%,user_id.ilike.%${query.search}%`);
  }
  const { data, error } = await q;
  if (error) throw new Error(`payments.admin-list failed: ${error.message}`);
  return Promise.all(
    (data ?? []).map(async (r) => {
      const p = paymentFromRow(r as Row);
      p.plan = await getPlanById(p.plan_id);
      return p;
    }),
  );
}

export async function countPaymentsAdmin(filters: { status?: PaymentStatus | null } = {}) {
  const sb = getAdminClient();
  let q = sb.from("payments").select("id", { count: "exact", head: true });
  if (filters.status) q = q.eq("status", filters.status);
  const { count, error } = await q;
  if (error) throw new Error(`payments.count failed: ${error.message}`);
  return count ?? 0;
}

export async function currentUserSubscriptionForActivation(userId: string) {
  return getCurrentSubscription(userId);
}