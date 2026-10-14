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

/**
 * The chain a USDC payment was made on, for display next to the token.
 *
 * Payment rows can carry a blank network: a deployment that injects an empty
 * `USDC_NETWORK` (a PaaS hazard called out in `config.ts`) baked `""` into
 * existing rows, and migration 0008 had to trim newline-padded values. Passing
 * that blank straight into a translated `{{network}}` placeholder throws in
 * non-production and renders a literal `{{network}}` in production, so both are
 * collapsed to the network this app actually settles on.
 */
export const DEFAULT_CRYPTO_NETWORK = "Base";

export function cryptoNetworkLabel(network: string | null | undefined): string {
  const trimmed = network?.trim();
  return trimmed ? trimmed : DEFAULT_CRYPTO_NETWORK;
}
