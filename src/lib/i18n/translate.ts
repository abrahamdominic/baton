/**
 * Translation runtime (lan.md §2, §11, §12, §18).
 *
 * A deliberately small, dependency-free engine. The alternative was adding an
 * i18n library, but lan.md requires adding languages without touching
 * components, and every mainstream library solves that with a provider, a
 * loader, and a plugin chain. For a JSON-namespace application that is a lot of
 * machinery for `t()`, interpolation and `Intl.PluralRules`, all of which the
 * platform already provides.
 *
 * Design rules that matter:
 *  - a component never sees a missing-key crash; it gets English, then a
 *    visible marker in development (lan.md §18)
 *  - plurals go through `Intl.PluralRules`, so Arabic and Russian get their
 *    real categories instead of an English-shaped ternary
 *  - a missing interpolation value throws in development rather than shipping
 *    "Hello, {{name}}" to a user
 */

import { DEFAULT_LOCALE } from "./config";

export type TranslationTree = { [key: string]: string | TranslationTree };

/** Flattened `namespace.key.path` -> value map, built once per locale. */
export type FlatTree = Record<string, string>;

export function flatten(tree: TranslationTree, prefix = "", out: FlatTree = {}): FlatTree {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out[path] = value;
    else flatten(value, path, out);
  }
  return out;
}

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;

/**
 * Replace `{{name}}` placeholders.
 *
 * A placeholder with no supplied value is left verbatim in production so the
 * gap is visible, and throws in development so it is caught by the test suite
 * rather than by a user.
 */
export function interpolate(
  template: string,
  values: Record<string, string | number> = {},
  locale = DEFAULT_LOCALE,
): string {
  return template.replace(PLACEHOLDER, (whole, key: string) => {
    const value = values[key];
    if (value === undefined || value === null || value === "") {
      if (process.env.NODE_ENV !== "production") {
        throw new Error(`[i18n] missing value for "${key}" in "${template}" (${locale})`);
      }
      return whole;
    }
    return String(value);
  });
}

/**
 * Select the plural form for a locale.
 *
 * CLDR category names are `one` / `other` / `zero` / `two` / `few` / `many`.
 * Two equivalent spellings are accepted, because both appear in real resource
 * files and the runtime must not depend on which one an author happened to use:
 *
 *   "item": { "one": "...", "other": "..." }   -> key `item.one`  (nested)
 *   "item_one": "...", "item_other": "..."     -> key `item_one`  (suffixed)
 *
 * A category with no defined form falls back to `other`, then `one`, so a
 * partially translated locale still renders something sensible.
 */
export function selectPlural(tree: FlatTree, key: string, count: number, locale: string): string {
  let category = "other";
  try {
    category = new Intl.PluralRules(locale).select(count);
  } catch {
    category = count === 1 ? "one" : "other";
  }

  const direct = variant(tree, key, category);
  if (direct !== undefined) return direct;

  // Fall back `other` first, then `one`. Order matters: CLDR has categories
  // beyond these two, and a translation that only defines the common pair must
  // resolve to a sensible form. Reaching for `one` first would render Russian's
  // `many` category (0, 5, 11...) as a singular phrase.
  for (const fallbackCategory of ["other", "one"]) {
    const fallback = variant(tree, key, fallbackCategory);
    if (fallback !== undefined) return fallback;
  }

  return tree[key] ?? key;
}

/** Looks up a plural form under both the nested and the suffixed spelling. */
function variant(tree: FlatTree, key: string, category: string): string | undefined {
  return tree[`${key}.${category}`] ?? tree[`${key}_${category}`];
}

export type TranslateValues = Record<string, string | number>;

/**
 * Translate `namespace:key` for a locale bundle.
 *
 * Resolution order is the requested locale, then English.
 *
 * A key missing from every bundle is a bug, not something a normal user should
 * ever see. Development renders a `⟨key⟩` marker so the gap is obvious, and
 * production renders a readable humanized label instead of the raw
 * `namespace:key` identifier, so a missing translation degrades the copy but
 * never exposes internal key names or crashes the render.
 */
export function createTranslator(
  bundles: Record<string, FlatTree>,
  locale: string,
) {
  const fallback = bundles[DEFAULT_LOCALE] ?? {};
  const active = bundles[locale] ?? {};

  return function t(key: string, values: TranslateValues = {}): string {
    const template = active[key] ?? fallback[key];

    if (template === undefined) return missingKeyLabel(key, locale, values);
    return interpolate(template, values, locale);
  };
}

/**
 * Turns a missing `namespace:key` into something a person can read.
 *
 * Never returns the raw key: `common:save` must not reach a user as
 * `common:save`. Development keeps a `⟨key⟩` marker so the omission is
 * impossible to miss, and tests see the key so assertions can target it.
 */
function missingKeyLabel(key: string, locale: string, values: TranslateValues = {}): string {
  if (process.env.NODE_ENV === "test") return key;
  if (process.env.NODE_ENV !== "production") return `⟨${key}⟩`;

  const leaf = key.slice(key.lastIndexOf(":") + 1).split(".")[0];
  const humanized = leaf.replace(/[_-]+/g, " ").trim();
  if (!humanized) return "";
  const rawCount = values.count;
  const count = typeof rawCount === "number" ? rawCount : Number(rawCount);
  const withCount = rawCount === undefined || !Number.isFinite(count)
    ? humanized
    : `${new Intl.NumberFormat(locale).format(count)} ${humanized}`;
  // Sentence case reads as intentional placeholder copy rather than a bug.
  // A leading formatted number has nothing to capitalize, so leave it alone.
  return /^[A-Za-z]/.test(withCount) ? withCount.charAt(0).toUpperCase() + withCount.slice(1) : withCount;
}

/** Count-aware translate. Counts are passed through as `count` by default. */
export function createCountTranslator(bundles: Record<string, FlatTree>, locale: string) {
  const fallback = bundles[DEFAULT_LOCALE] ?? {};
  const active = bundles[locale] ?? {};

  /**
   * True when the locale itself defines this key, in any plural form.
   *
   * Checking `active[key]` alone would always miss, because a pluralised key is
   * stored as `key.one` / `key.other` and never as a bare `key`. That bug
   * silently served English plurals for every locale.
   */
  const definesPlural = (tree: FlatTree, key: string) =>
    tree[key] !== undefined ||
    Object.keys(tree).some((k) => k.startsWith(`${key}.`) || k.startsWith(`${key}_`));

  return function tc(key: string, count: number, values: TranslateValues = {}): string {
    const local = definesPlural(active, key);
    const chosen = local
      ? selectPlural(active, key, count, locale)
      : selectPlural(fallback, key, count, locale);
    if (chosen === key) return missingKeyLabel(key, locale, { count, ...values });
    return interpolate(chosen, { count, ...values }, locale);
  };
}
