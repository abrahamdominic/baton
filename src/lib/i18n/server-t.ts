import "server-only";

/**
 * Server-side translator (lan.md §28).
 *
 * Server components need to translate too, and duplicating the bundle-joining
 * logic in every page is exactly the "scattered translation logic" the spec
 * forbids. This is the single server entry point:
 *
 *   const t = await getTranslator(locale);
 *   t("settings:title")
 *
 * For metadata, `getTranslatorForRequest` resolves the locale itself.
 */

import { loadBundle } from "./bundles";
import { createCountTranslator, createTranslator } from "./translate";
import { resolveRequestLocale } from "./resolve";
import { directionFor, localeTag, type Locale } from "./config";
import {
  formatBytes,
  formatCompact,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatRelative,
  formatTime,
} from "./format";

export async function getTranslator(locale: string) {
  const bundles = await loadBundle(locale);
  return createTranslator(bundles, locale);
}

export async function getCountTranslator(locale: string) {
  const bundles = await loadBundle(locale);
  return createCountTranslator(bundles, locale);
}

/** Translator plus locale metadata, for pages that set `<html>` or metadata. */
export async function getTranslatorForRequest() {
  const { locale, accountLocale } = await resolveRequestLocale();
  const t = await getTranslator(locale);
  const tc = await getCountTranslator(locale);
  // Formatting helpers are bound to the resolved locale so a server component
  // can never accidentally format against the server's own locale. Calling
  // `toLocaleDateString()` with no locale on the server would render dates in
  // the machine's locale and ship the wrong format to the user.
  return {
    t,
    tc,
    locale: locale as Locale,
    accountLocale,
    direction: directionFor(locale),
    tag: localeTag(locale),
    formatNumber: (value: number, options?: Intl.NumberFormatOptions) =>
      formatNumber(value, locale, options),
    formatDate: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) =>
      formatDate(value, locale, options),
    formatCurrency: (cents: number, currency: string, options?: Intl.NumberFormatOptions) =>
      formatCurrency(cents, currency, locale, options),
    formatPercent: (value: number, options?: Intl.NumberFormatOptions) =>
      formatPercent(value, locale, options),
    formatRelative: (value: Date | string | number) => formatRelative(value, locale),
    formatTime: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) =>
      formatTime(value, locale, options),
    formatDateTime: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) =>
      formatDateTime(value, locale, options),
    formatCompact: (value: number) => formatCompact(value, locale),
    formatBytes: (value: number) => formatBytes(value, locale),
  };
}
