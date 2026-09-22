import "server-only";
import { getAdminClient } from "@/lib/supabase/client";
import { SUBSCRIPTION_STATUSES, PAYMENT_STATUSES } from "./types";

/**
 * Cheap Supabase aggregations for the admin Overview/Analytics pages.
 * All are service-role reads with small row counts; okay for a control panel.
 */

export async function subscriptionStatusCounts() {
  const sb = getAdminClient();
  const { data, error } = await sb.from("subscriptions").select("status");
  if (error) throw new Error(`analytics.subs failed: ${error.message}`);
  const counts: Record<string, number> = {};
  for (const s of SUBSCRIPTION_STATUSES) counts[s] = 0;
  for (const row of data ?? []) {
    const status = String(row.status ?? "none");
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

export async function confirmedPaymentAggregates() {
  const sb = getAdminClient();
  const { data, error } = await sb.from("payments").select("status,payment_provider,amount,currency");
  if (error) throw new Error(`analytics.payments failed: ${error.message}`);
  const rows = data ?? [];
  const byProvider: Record<string, { count: number; amountMinor: number }> = {};
  const byStatus: Record<string, number> = {};
  for (const s of PAYMENT_STATUSES) byStatus[s] = 0;
  let totalConfirmedMinor = 0;
  for (const row of rows) {
    const provider = String(row.payment_provider ?? "usdc");
    const status = String(row.status ?? "pending");
    const amount = Number(row.amount ?? 0);
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    if (status === "confirmed") {
      totalConfirmedMinor += amount;
      const entry = (byProvider[provider] ??= { count: 0, amountMinor: 0 });
      entry.count += 1;
      entry.amountMinor += amount;
    }
  }
  return { totalConfirmedMinor, byProvider, byStatus, totalRows: rows.length };
}

export async function adminDashboardMetrics() {
  const [subs, payments] = await Promise.all([
    subscriptionStatusCounts(),
    confirmedPaymentAggregates(),
  ]);
  return {
    activeSubscriptions: subs.active + subs.active_until_period_end,
    pendingSubscriptions: subs.pending,
    pastDue: subs.past_due + subs.payment_failed,
    canceledOrExpired: subs.canceled + subs.expired,
    payments,
  };
}