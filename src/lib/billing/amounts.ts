import type { Cents } from "./types";

/**
 * Precise monetary handling.
 *
 * All money is integer minor units (cents / 2-decimal units). JavaScript
 * floating-point math is never used for financial calculations. USDC on Base
 * uses 6 on-chain decimals; Baton presents USDC in 2-decimal "dollar form",
 * so the on-chain value of an amount is `cents * 10^(6-2)`.
 */

const USDC_ONCHAIN_DECIMALS = 6;
const DISPLAY_DECIMALS = 2;
const MINOR_FACTOR = DISPLAY_DECIMALS - USDC_ONCHAIN_DECIMALS; // -4

/** On-chain USDC base units per cent (1e6 / 1e2). */
export const ONCHAIN_UNITS_PER_CENT = 10n ** 4n;

/**
 * Sub-cent space available for a per-order deposit nonce: the 4 decimal places
 * below a cent. A nonce of 1..9999 makes each order's exact on-chain amount
 * unique without changing the credited plan price.
 */
export const USDC_NONCE_MAX = 9999n;

/** Convert a display minor-unit amount to the integer USDC on-chain value. */
export function minorToUsdcOnchain(cents: Cents): number {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new Error(`invalid amount: ${cents}`);
  }
  return cents * 10 ** -MINOR_FACTOR;
}

/** Convert an on-chain USDC integer value to Baton's 2-decimal minor units. */
export function usdcOnchainToMinor(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`invalid on-chain value: ${value}`);
  }
  if (value % 10 ** -MINOR_FACTOR !== 0) {
    // A sub-cent transfer cannot match a 2-decimal priced plan exactly.
    throw new Error(`non-decimal-cent transfer: ${value}`);
  }
  return value / 10 ** -MINOR_FACTOR;
}

/** Exact on-chain USDC amount (6 decimals) as a decimal string. */
export function formatUsdcOnchain(value: bigint): string {
  if (value < 0n) throw new Error(`invalid on-chain value: ${value}`);
  const whole = value / 1_000_000n;
  const frac = (value % 1_000_000n).toString().padStart(6, "0");
  return `${whole}.${frac}`;
}

export function formatMoney(cents: Cents, currency: string): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = (abs % 100).toString().padStart(2, "0");
  const major = `${whole}.${frac}`;
  if (currency === "USDC") return `${sign}$${major} USDC`;
  return `${sign}$${major} ${currency === "USD" ? "" : currency}`.trim();
}
