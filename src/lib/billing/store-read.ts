import "server-only";
import { logger } from "@/lib/logger";

/**
 * Tolerant read of the billing store (Supabase).
 *
 * Billing lives in an external Postgres behind Supabase's REST API. A read can
 * fail for reasons that have nothing to do with the request: the project is
 * paused, DNS/egress is down, a connection is refused, or the store is simply
 * slow enough to time out. Those are upstream outages, and a page that renders
 * an optional section from the store (payment history, lifecycle log) must not
 * turn one into a fatal server error that replaces the whole dashboard.
 *
 * `readBillingStore` runs the operation, and on failure logs the real cause and
 * returns the caller's fallback plus `ok: false`. Callers use `ok` to render a
 * truthful "unavailable" state rather than presenting an empty list as if the
 * customer simply had no payments. Throwing operations (checkout, cancel,
 * confirm) deliberately do NOT use this: a write that cannot reach the store
 * must fail loudly.
 */
export interface BillingStoreRead<T> {
  /** The value returned by the operation, or the fallback when it failed. */
  value: T;
  /** False when the operation threw (the store could not be read). */
  ok: boolean;
}

export async function readBillingStore<T>(
  operation: string,
  read: () => Promise<T>,
  fallback: T,
): Promise<BillingStoreRead<T>> {
  try {
    return { value: await read(), ok: true };
  } catch (err) {
    logger.error("billing-store-read-failed", {
      operation,
      error: err instanceof Error ? err.message : String(err),
    });
    return { value: fallback, ok: false };
  }
}
