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

export function formatMoney(cents: Cents, currency: string): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = (abs % 100).toString().padStart(2, "0");
  const major = `${whole}.${frac}`;
  if (currency === "USDC") return `${sign}$${major} USDC`;
  return `${sign}$${major} ${currency === "USD" ? "" : currency}`.trim();
}