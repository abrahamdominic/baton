import "server-only";
import { getAdminClient } from "@/lib/supabase/client";
import { getPlanById } from "./plans";
import { giftFromRow, type Row } from "./records";
import { BillingInputError } from "./errors";
import { recordSubscriptionEvent } from "./events";
import { recordSystemEvent } from "./system-events";
import { logAdminAudit } from "./audit";
import { subscriptionFromRow } from "./records";
import type { GiftRecord, SubscriptionRecord } from "./types";

/**
 * Admin-gifted plan grants.
 *
 * A gift is real entitlement but NOT a payment: no payment row is created, no
 * Stripe or USDC moves money, nothing shows up as a paid transaction. It is a
 * `subscriptions` row labelled `payment_provider = 'gift'` (so the UI can
 * plainly distinguish it from paid access), an immutable `subscription_events`
 * entry with source `admin`, and a `gift_grants` ledger row. Housekeeping
 * expires the grant automatically at `access_ends_at` and entitlement reverts
 * on schedule — the gift can never quietly renew or overstay.
 */

export const GIFT_MIN_MONTHS = 1;
export const GIFT_MAX_MONTHS = 120;

export interface GiftPlanInput {
  adminUserId: string;
  userId: string;
  userLogin: string;
  planId: string;
  durationType: "monthly" | "annual";
  months: number;
  note?: string;
}

export interface GiftPlanResult {
  gift: GiftRecord;
  subscription: SubscriptionRecord;
  accessEndsAt: string;
}

export async function createGiftedAccess(input: GiftPlanInput): Promise<GiftPlanResult> {
  const plan = await getPlanById(input.planId);
  if (!plan || !plan.is_active) {
    throw new BillingInputError("That plan does not exist or is not available to gift.");
  }
  const months = Math.round(input.months);
  if (!Number.isFinite(months) || months < GIFT_MIN_MONTHS || months > GIFT_MAX_MONTHS) {
    throw new BillingInputError(`Gift duration must be between ${GIFT_MIN_MONTHS} and ${GIFT_MAX_MONTHS} months.`);
  }
  const note = (input.note ?? "").trim();
  if (note && note.length > 500) {
    throw new BillingInputError("Gift note is too long (max 500 characters).");
  }

  const now = new Date();
  const accessEndsAt = new Date(now);
  accessEndsAt.setUTCMonth(accessEndsAt.getUTCMonth() + months);
  const startIso = now.toISOString();
  const endIso = accessEndsAt.toISOString();

  const sb = getAdminClient();

  const { data: subData, error: subError } = await sb
    .from("subscriptions")
    .insert({
      user_id: input.userId,
      plan_id: plan.id,
      status: "active",
      payment_provider: "gift",
      current_period_start: startIso,
      current_period_end: endIso,
      started_at: startIso,
    })
    .select("*")
    .single();
  if (subError) throw new Error(`gifts.subscription failed: ${subError.message}`);
  const subscription = subscriptionFromRow(subData as Row, plan);

  await recordSubscriptionEvent({
    subscriptionId: subscription.id,
    userId: input.userId,
    eventType: "subscription_gifted",
    previousStatus: null,
    newStatus: "active",
    newPlanId: plan.id,
    source: "admin",
    reason: note || null,
    metadata: {
      planSlug: plan.slug,
      grant: "gift",
      adminUserId: input.adminUserId,
      userLogin: input.userLogin,
      durationType: input.durationType,
      months,
      accessEndsAt: endIso,
    },
  });

  const { data: giftData, error: giftError } = await sb
    .from("gift_grants")
    .insert({
      user_id: input.userId,
      plan_id: plan.id,
      admin_user_id: input.adminUserId,
      duration_type: input.durationType,
      months,
      note: note || null,
      subscription_id: subscription.id,
      access_started_at: startIso,
      access_ends_at: endIso,
    })
    .select("*")
    .single();
  if (giftError) throw new Error(`gifts.grant failed: ${giftError.message}`);
  const gift = giftFromRow(giftData as Row, plan);

  await recordSystemEvent({
    eventType: "admin_gifted_plan",
    severity: "info",
    status: "granted",
    message: `Admin ${input.adminUserId} gifted ${plan.slug} (${months} months) to @${input.userLogin}`,
    userId: input.userId,
    metadata: { adminUserId: input.adminUserId, planId: plan.id, planSlug: plan.slug, months, accessEndsAt: endIso },
  });

  await logAdminAudit({
    adminUserId: input.adminUserId,
    action: "billing.gift.plan",
    resourceType: "subscription",
    resourceId: subscription.id,
    detail: {
      userId: input.userId,
      userLogin: input.userLogin,
      planId: plan.id,
      planSlug: plan.slug,
      durationType: input.durationType,
      months,
      accessEndsAt: endIso,
      note: note || null,
    },
  });

  return { gift, subscription, accessEndsAt: endIso };
}

/** Admin: most recent gift grants (with plan rows), newest first. */
export async function listGifts(limit = 50): Promise<GiftRecord[]> {
  const sb = getAdminClient();
  const { data, error } = await sb
    .from("gift_grants")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(Math.min(200, limit));
  if (error) throw new Error(`gifts.list failed: ${error.message}`);
  return Promise.all(
    (data ?? []).map(async (r) => {
      const g = giftFromRow(r as Row);
      g.plan = await getPlanById(g.plan_id);
      return g;
    }),
  );
}

/** A user's gift grants (used by the billing page to explain gifted access). */
export async function listGiftsForUser(userId: string, limit = 10): Promise<GiftRecord[]> {
  const sb = getAdminClient();
  const { data, error } = await sb
    .from("gift_grants")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`gifts.user-list failed: ${error.message}`);
  return Promise.all(
    (data ?? []).map(async (r) => {
      const g = giftFromRow(r as Row);
      g.plan = await getPlanById(g.plan_id);
      return g;
    }),
  );
}