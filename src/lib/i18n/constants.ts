/**
 * i18n primitives.
 *
 * Split out from `config.ts` so the language registry can depend on these
 * without `config.ts` and `registry.ts` importing each other. A module cycle
 * between the locale registry and the locale helpers is the kind of thing that
 * works until someone imports `registry` first in a different order.
 */

/** The locale everything degrades to. Kept complete, always shipped. */
export const DEFAULT_LOCALE = "en";

/**
 * Centralised storage key (lan.md §7). One constant so the prepaint script, the
 * provider, and the sync logic cannot drift apart.
 */
export const LANGUAGE_STORAGE_KEY = "baton.language";

/**
 * Locales written right-to-left (lan.md §14).
 *
 * The UI does not switch on this list directly: `directionFor` reads the
 * registry entry, so a new RTL language is declared once alongside its other
 * metadata rather than in two places that can disagree.
 */
export const RTL_LANGS = new Set(["ar", "he", "fa", "ur", "ps", "sd", "ug", "yi"]);
