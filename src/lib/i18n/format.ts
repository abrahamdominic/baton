/**
 * Locale-aware formatters (lan.md §13).
 *
 * Dates, times, numbers, percentages, and currency must be formatted through
 * `Intl`, never assembled by string concatenation, because digit grouping,
 * decimal separators, currency symbol placement, and the order of date parts
 * are all locale-specific.
 *
 * These live in their own module so the client provider and the server
 * translator share one implementation. Duplicating them per-surface is how a
 * server component ends up rendering `$1,234.00` for a user whose locale
 * expects `1.234,00 $`.
 *
 * Every helper takes the locale explicitly. A bare `toLocaleDateString()` on
 * the server formats against the machine's locale, not the user's.
 */

function toDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

export function formatNumber(
  value: number,
  locale: string,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

export function formatDate(
  value: Date | string | number,
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(locale, options ?? { dateStyle: "medium" }).format(
    toDate(value),
  );
}

export function formatTime(
  value: Date | string | number,
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(locale, options ?? { timeStyle: "short" }).format(
    toDate(value),
  );
}

export function formatDateTime(
  value: Date | string | number,
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(
    locale,
    options ?? { dateStyle: "medium", timeStyle: "short" },
  ).format(toDate(value));
}

/**
 * Relative time such as "3 days ago".
 *
 * Uses `Intl.RelativeTimeFormat` so the unit and wording come from CLDR. A
 * hand-rolled `${n} days ago` cannot express languages that place the number
 * after the unit, which is most of them.
 */
export function formatRelative(
  value: Date | string | number,
  locale: string,
  now: Date = new Date(),
): string {
  const target = toDate(value).getTime();
  const diffMs = target - now.getTime();
  const abs = Math.abs(diffMs);

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 365 * 24 * 60 * 60 * 1000],
    ["month", 30 * 24 * 60 * 60 * 1000],
    ["week", 7 * 24 * 60 * 60 * 1000],
    ["day", 24 * 60 * 60 * 1000],
    ["hour", 60 * 60 * 1000],
    ["minute", 60 * 1000],
  ];

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, ms] of units) {
    if (abs >= ms) return rtf.format(Math.round(diffMs / ms), unit);
  }
  return rtf.format(Math.round(diffMs / 1000), "second");
}

/**
 * Formats a value already expressed in percent units.
 *
 * `value` is the human-facing percentage, so `12.5` renders as `12.5%` and not
 * `0.125%`. Callers holding a ratio should multiply before calling.
 */
export function formatPercent(
  value: number,
  locale: string,
  options?: Intl.NumberFormatOptions,
): string {
  // Intl defaults percentages to zero fraction digits, which silently rounds
  // 12.5% to 13%. One decimal is the useful default for a metric; callers can
  // still override it through `options`.
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 1,
    ...options,
  }).format(value / 100);
}

/**
 * Formats an integer amount of minor units (cents) as currency.
 *
 * Money is stored in cents everywhere in this codebase, so dividing by 100 here
 * is the single place that conversion happens. Formatting the raw integer
 * would be off by two orders of magnitude.
 */
export function formatCurrency(
  cents: number,
  currency: string,
  locale: string,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    ...options,
  }).format(cents / 100);
}

/** Compact counts such as `1.2K`, using the locale's own compact notation. */
export function formatCompact(
  value: number,
  locale: string,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
    ...options,
  }).format(value);
}

/** Byte sizes with binary units, e.g. `4.2 MB`. */
export function formatBytes(bytes: number, locale: string): string {
  const units = ["B", "kB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const number = new Intl.NumberFormat(locale, {
    maximumFractionDigits: unit === 0 ? 0 : 1,
  }).format(value);
  return `${number} ${units[unit]}`;
}
