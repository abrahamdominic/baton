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

/**
 * Confirmed payment totals bucketed by currency.
 *
 * Amounts are never summed across currencies: a USDC payment is recorded in
 * USDC minor units, so adding it to a USD total and labelling the result "USD"
 * reports a fabricated number. Each currency keeps its own minor-unit total
 * and its own formatting.
 */
export interface CurrencyTotal {
  count: number;
  amountMinor: number;
}

export interface PaymentAggregates {
  /** Confirmed totals keyed by currency, e.g. `{ USD: {...}, USDC: {...} }`. */
  byCurrency: Record<string, CurrencyTotal>;
  byProvider: Record<string, CurrencyTotal>;
  byStatus: Record<string, number>;
  totalRows: number;
}

export async function confirmedPaymentAggregates(): Promise<PaymentAggregates> {
  const sb = getAdminClient();
  const { data, error } = await sb.from("payments").select("status,payment_provider,amount,currency");
  if (error) throw new Error(`analytics.payments failed: ${error.message}`);
  const rows = data ?? [];
  const byProvider: Record<string, CurrencyTotal> = {};
  const byCurrency: Record<string, CurrencyTotal> = {};
  const byStatus: Record<string, number> = {};
  for (const s of PAYMENT_STATUSES) byStatus[s] = 0;
  for (const row of rows) {
    const provider = String(row.payment_provider ?? "usdc");
    const status = String(row.status ?? "pending");
    const currency = String(row.currency ?? "USD").toUpperCase();
    const amount = Number(row.amount ?? 0);
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    if (status !== "confirmed") continue;
    const providerEntry = (byProvider[provider] ??= { count: 0, amountMinor: 0 });
    providerEntry.count += 1;
    providerEntry.amountMinor += amount;
    const currencyEntry = (byCurrency[currency] ??= { count: 0, amountMinor: 0 });
    currencyEntry.count += 1;
    currencyEntry.amountMinor += amount;
  }
  return { byCurrency, byProvider, byStatus, totalRows: rows.length };
}

/**
 * Every `payments.amount` in Baton's ledger is stored in 2-decimal minor units,
 * including USDC. `src/lib/billing/amounts.ts` converts the 6-decimal on-chain
 * value down to that same 2-decimal scale before anything is persisted, so a
 * $49.00 USDC order is `4900` on both the card and the crypto path (see
 * `planPriceCents` in the checkout route). A per-currency decimals table used
 * to claim USDC was 6-decimal, which rendered a real $49.00 payment as
 * "USDC 0.004900" on the admin dashboard.
 */
const MINOR_UNIT_DECIMALS = 2;

/** Format a minor-unit total in its own currency. Never mixes currencies. */
export function formatCurrencyTotal(currency: string, amountMinor: number): string {
  const value = (amountMinor / 10 ** MINOR_UNIT_DECIMALS).toLocaleString("en-US", {
    minimumFractionDigits: MINOR_UNIT_DECIMALS,
    maximumFractionDigits: MINOR_UNIT_DECIMALS,
  });
  return `${currency.toUpperCase()} ${value}`;
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