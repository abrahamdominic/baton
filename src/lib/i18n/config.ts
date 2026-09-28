/**
 * Locale helpers - the public surface for everything locale-shaped.
 *
 * Components import from here and never touch a locale code, a language
 * directory, or a formatting tag directly. The registry (what we support) lives
 * in `registry.ts`; this module is how the rest of the app asks questions
 * about it.
 *
 * See `constants.ts` for the module split that keeps this file free of import
 * cycles.
 */

import { DEFAULT_LOCALE, LANGUAGE_STORAGE_KEY, RTL_LANGS } from "./constants";
import {
  AVAILABLE_LOCALES,
  AVAILABLE_LANGUAGES,
  LOCALES,
  type LocaleDefinition,
} from "./registry";

export { DEFAULT_LOCALE, LANGUAGE_STORAGE_KEY, RTL_LANGS };
export type { LocaleDefinition };
export { AVAILABLE_LANGUAGES, AVAILABLE_LOCALES, LOCALES };

export type Locale = string;

const BY_ID = new Map(LOCALES.map((l) => [l.id, l]));

/** Locale ids Baton can actually render, in registry order. */
export const SUPPORTED_LOCALES: readonly string[] = AVAILABLE_LOCALES.map((l) => l.id);
export const ALL_LOCALES: readonly LocaleDefinition[] = LOCALES;
export const LOCALE_IDS: readonly string[] = LOCALES.map((l) => l.id);

/**
 * Every *shipped* locale id for a translation language, e.g. `es-MX`, `es-AR`.
 *
 * Built from `AVAILABLE_LOCALES`, not `LOCALES`: a language with no resources
 * must resolve to an empty list, not to an id the rest of the app would then
 * treat as renderable.
 */
const BY_LANG = new Map<string, LocaleDefinition[]>();
for (const l of AVAILABLE_LOCALES) {
  const list = BY_LANG.get(l.lang) ?? [];
  list.push(l);
  BY_LANG.set(l.lang, list);
}

/** Look up a locale definition, or undefined for an unknown id. */
export function localeDefinition(id: string): LocaleDefinition | undefined {
  return BY_ID.get(id);
}

/** True when the id is registered *and* shipped. */
export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === "string" && SUPPORTED_LOCALES.includes(value);
}

/** Text direction. Unknown input falls back to the language's script default. */
export function directionFor(locale: string): "ltr" | "rtl" {
  const def = BY_ID.get(locale);
  if (def) return def.direction;
  return RTL_LANGS.has(locale.split("-")[0]!) ? "rtl" : "ltr";
}

/**
 * BCP-47 tag for `Intl` and `<html lang>`.
 *
 * For a registered locale this is the registry tag, so `zh` resolves to its
 * default script and `en` to `en-US`. For anything unregistered it returns the
 * input unchanged, which keeps the function total instead of throwing deep in
 * a component tree.
 */
export function localeTag(locale: string): string {
  return BY_ID.get(locale)?.tag ?? locale;
}

/** The translation-set language for a locale: `pt-BR` -> `pt`. */
export function languageFor(locale: string): string {
  return BY_ID.get(locale)?.lang ?? locale.split("-")[0]!;
}

/** The locale id to use for a given translation language. */
export function defaultLocaleForLanguage(lang: string): Locale {
  const list = BY_LANG.get(lang);
  if (!list) return DEFAULT_LOCALE;
  // Prefer the base id when it exists (`pt`), else the first shipped variant.
  return list.find((l) => l.id === lang)?.id ?? list[0]!.id;
}

/** Every locale id for a translation language, e.g. `pt-BR`, `pt-PT`. */
export function localesForLanguage(lang: string): LocaleDefinition[] {
  return BY_LANG.get(lang) ?? [];
}

/**
 * Resolves a browser/`Accept-Language` tag to a shipped locale.
 *
 * Order of preference (lan.md §6, §7):
 *   1. exact locale id      `pt-BR` -> `pt-BR`
 *   2. exact BCP-47 tag     a tag registered under a different id still matches
 *   3. base language        `fr-CA` -> the default locale for `fr`
 *   4. English, always
 *
 * The input may be a full `Accept-Language` header, so entries are split and
 * quality values stripped first: `fr-CA,fr;q=0.9,en;q=0.8` must resolve to
 * French, not to the literal header string.
 *
 * This is only ever applied when the user has *not* chosen a language. An
 * explicit choice is stored and read back verbatim, so browser detection can
 * never override it.
 */
export function resolveLocale(candidate: string | null | undefined): Locale {
  if (!candidate) return DEFAULT_LOCALE;

  for (const part of candidate.split(",")) {
    const tag = part.split(";")[0]?.trim();
    if (!tag) continue;
    // Skip anything that is not a well-formed language tag rather than letting
    // it fall through to a surprising base-language match.
    if (!/^[A-Za-z]{2,8}(-[A-Za-z0-9]{2,8})*$/.test(tag)) continue;

    const exact = matchTag(tag);
    if (exact) return exact;

    // `pt-XX` -> `pt`; also `zh-Hant-TW` -> `zh-Hant` -> `zh`.
    const parts = tag.split("-");
    for (let i = parts.length - 1; i > 0; i--) {
      const hit = matchTag(parts.slice(0, i).join("-"));
      if (hit) return hit;
    }
  }
  return DEFAULT_LOCALE;
}

/**
 * Matches a single tag against the registry, case-insensitively, against both
 * the locale id and the BCP-47 tag. Shipped entries only, so detection can
 * never select a locale with no resources.
 */
function matchTag(tag: string): Locale | null {
  const lower = tag.toLowerCase();

  for (const l of AVAILABLE_LOCALES) {
    if (l.id.toLowerCase() === lower) return l.id;
  }
  for (const l of AVAILABLE_LOCALES) {
    if (l.tag.toLowerCase() === lower) return l.id;
  }
  return null;
}

/**
 * The preferred locale for a `navigator.languages`-style list.
 *
 * Prefers the first entry the user actually listed, and only considers the
 * rest for coverage. A `["fr-CA","en-US"]` navigator resolves to French.
 */
export function resolveFromNavigatorList(
  list: readonly string[] | undefined | null,
): Locale {
  if (!list || list.length === 0) return DEFAULT_LOCALE;
  for (const candidate of list) {
    const resolved = resolveLocale(candidate);
    if (resolved !== DEFAULT_LOCALE) return resolved;
  }
  return DEFAULT_LOCALE;
}
