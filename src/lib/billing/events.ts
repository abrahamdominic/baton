import "server-only";
import { getAdminClient } from "@/lib/supabase/client";
import type { SubscriptionStatus } from "./types";

export interface SubscriptionEventInput {
  subscriptionId: string | null;
  userId: string;
  eventType: string;
  previousStatus?: SubscriptionStatus | null;
  newStatus?: SubscriptionStatus | null;
  previousPlanId?: string | null;
  newPlanId?: string | null;
  paymentId?: string | null;
  source: "stripe" | "usdc" | "admin" | "system" | "user";
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Append a subscription lifecycle event. Immutable history used for analytics
 * and debugging; never overwritten or deleted.
 */
export async function recordSubscriptionEvent(input: SubscriptionEventInput): Promise<void> {
  const sb = getAdminClient();
  await sb.from("subscription_events").insert({
    subscription_id: input.subscriptionId ?? null,
    user_id: input.userId,
    event_type: input.eventType,
    previous_status: input.previousStatus ?? null,
    new_status: input.newStatus ?? null,
    previous_plan_id: input.previousPlanId ?? null,
    new_plan_id: input.newPlanId ?? null,
    payment_id: input.paymentId ?? null,
    source: input.source,
    reason: input.reason ?? null,
    metadata: input.metadata ?? {},
  });
}

export async function listSubscriptionEvents(userId: string, limit = 50) {
  const sb = getAdminClient();
  const { data, error } = await sb
    .from("subscription_events")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`subscription_events.list failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: String(r.id),
    subscriptionId: r.subscription_id ? String(r.subscription_id) : null,
    userId: String(r.user_id),
    eventType: String(r.event_type),
    previousStatus: r.previous_status ? String(r.previous_status) : null,
    newStatus: r.new_status ? String(r.new_status) : null,
    previousPlanId: r.previous_plan_id ? String(r.previous_plan_id) : null,
    newPlanId: r.new_plan_id ? String(r.new_plan_id) : null,
    paymentId: r.payment_id ? String(r.payment_id) : null,
    source: String(r.source),
    reason: r.reason ? String(r.reason) : null,
    metadata: r.metadata ?? {},
    createdAt: String(r.created_at),
  }));
}