/**
 * Display labels for billing enums (lan.md §22).
 *
 * `SubscriptionStatus` and `PaymentStatus` are stored in the database and sent
 * over the wire as raw slugs, so they must never be translated at the write
 * boundary. They are only ever meant for human eyes, and the same enum shows
 * up in the customer dashboard, the admin console, and the order receipts. All
 * three read their labels from here so the wording cannot drift between them.
 *
 * A missing key falls back to the raw slug rather than a blank cell: an
 * unrecognised status is still more useful to an operator than nothing at all.
 */

import type { Translator } from "./translate";
import { PAYMENT_STATUSES, SUBSCRIPTION_STATUSES } from "../billing/types";

function labelFor(
  value: string,
  kind: "payment_status" | "subscription_status",
  known: readonly string[],
  translate: Translator,
): string {
  if (known.includes(value)) {
    return translate(`billing:${kind}_${value}`);
  }
  return value;
}

export function paymentStatusLabel(status: string, translate: Translator): string {
  return labelFor(status, "payment_status", PAYMENT_STATUSES, translate);
}

export function subscriptionStatusLabel(status: string, translate: Translator): string {
  return labelFor(status, "subscription_status", SUBSCRIPTION_STATUSES, translate);
}
