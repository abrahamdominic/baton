/**
 * Central language registry (lan.md §3).
 *
 * One table describing every locale Baton knows about. Adding a language is an
 * entry here plus a resource directory - no component, provider, or selector
 * change. That is the whole point of this file.
 *
 * ## Why a table and not `Intl.DisplayNames` alone
 *
 * `Intl.DisplayNames` supplies the *names*, and it is the right source for them:
 * it is CLDR data shipped with the runtime, so it cannot contain a misspelling
 * and it corrects itself with the platform. The names are therefore derived,
 * not typed, in `languages.ts`.
 *
 * What CLDR cannot tell us is which of its ~8,000 locales Baton actually ships,
 * what each one should be called, how to group them, or which regional variants
 * exist. That is this file's job. Keeping "what we support" and "how a language
 * is named" separate means a name improvement needs no registry change and a
 * new language needs no naming code.
 *
 * ## Language vs locale
 *
 * `lang` selects the translation files (`locales/<lang>/`); `tag` is the BCP-47
 * locale used for `Intl` formatting and `<html lang>`. Several locales can share
 * one `lang` - `pt-BR`, `pt-PT` and `pt-AO` all read `locales/pt/` but format
 * dates, numbers and currency differently. This is why regional variants are
 * cheap: they are one line, not one copy of the translation set.
 *
 * ## `available`
 *
 * `available: true` means resource files exist and are complete. The validator
 * enforces that: a locale marked available without a `locales/<lang>/` directory
 * is an error, and a language with no available locale is never offered in the
 * picker. Nothing here is ever offered on the strength of an intent to translate
 * it later, because a language switch that silently renders English is a worse
 * experience than the language not being listed.
 */

/** Broad grouping for the Language page, so a long list stays scannable. */
export type LanguageGroup = "europe" | "americas" | "asia" | "africa" | "middle_east";

export interface LocaleDefinition {
  /** Stable id used in the cookie, localStorage, and the `dir`/`lang` attributes. */
  id: string;
  /** Translation-set language; selects `locales/<lang>/`. */
  lang: string;
  /** BCP-47 tag for every `Intl.*` call and for `<html lang>`. */
  tag: string;
  /** Script subtag, when it differs from the language default. */
  script?: string;
  /** Region used for the flag/region badge, when one is meaningful. */
  region?: string;
  direction: "ltr" | "rtl";
  group: LanguageGroup;
  /**
   * Resource files exist and are complete. Gates the whole UI.
   *
   * Defaults to `false` on purpose. An entry here is a *claim* about what the
   * product intends to support; this flag is the claim that the translation
   * work is actually done. Defaulting the other way makes a newly typed entry
   * ship instantly, and a language switch that silently renders English is worse
   * than that language not being listed at all. Flipping it to `true` is the
   * deliberate final step, after `validate-translations.mjs` passes.
   */
  available: boolean;
}

/**
 * @param id      locale id, what the user actually selects
 * @param lang    translation set, may be shared between regional variants
 * @param tag     BCP-47 tag for `Intl`
 * @param extra   direction, grouping, availability, script/region metadata
 */
const L = (
  id: string,
  lang: string,
  tag: string,
  extra: Partial<Omit<LocaleDefinition, "id" | "lang" | "tag">> = {},
): LocaleDefinition => ({
  id,
  lang,
  tag,
  direction: extra.direction ?? "ltr",
  group: extra.group ?? "europe",
  available: extra.available ?? false,
  ...(extra.script ? { script: extra.script } : {}),
  ...(extra.region ? { region: extra.region } : {}),
});

/** Marks a locale as shipped. Only for a language with complete resources. */
const SHIPPED = { available: true } as const;

const EUROPE: LanguageGroup = "europe";
const AMERICAS: LanguageGroup = "americas";
const ASIA: LanguageGroup = "asia";
const AFRICA: LanguageGroup = "africa";
const MIDDLE_EAST: LanguageGroup = "middle_east";

/**
 * Every locale Baton knows about.
 *
 * Ordered so the shipped set reads naturally on the Language page; the picker
 * sorts by native name at render time, so this order only matters for the
 * default-locale lookup and for tests.
 */
export const LOCALES: readonly LocaleDefinition[] = [
  // --- Shipped: complete resources exist under `locales/<lang>/` ---------
  // Regional variants deliberately share a translation set. `en-GB` and `es-MX`
  // cost one registry line, not a second copy of 431 keys.
  L("en", "en", "en-US", { group: AMERICAS, ...SHIPPED }),
  L("en-GB", "en", "en-GB", { group: EUROPE, region: "GB", ...SHIPPED }),
  L("es", "es", "es-ES", { group: EUROPE, region: "ES", ...SHIPPED }),
  L("es-MX", "es", "es-MX", { group: AMERICAS, region: "MX", ...SHIPPED }),
  L("es-AR", "es", "es-AR", { group: AMERICAS, region: "AR", ...SHIPPED }),

  // --- Planned: registered and formatted, but not yet offered ------------
  // Kept here so the direction, grouping, tag, and variant structure are settled
  // and reviewable in one place, and so the moment `locales/<lang>/` lands the
  // entry is one word away from shipping. Do not add `...SHIPPED` to any of
  // these until the resource directory exists and the validator passes.
  L("fr", "fr", "fr-FR", { group: EUROPE, region: "FR" }),
  L("fr-CA", "fr", "fr-CA", { group: AMERICAS, region: "CA" }),
  L("de", "de", "de-DE", { group: EUROPE, region: "DE" }),
  L("pt", "pt", "pt-PT", { group: EUROPE, region: "PT" }),
  L("pt-BR", "pt", "pt-BR", { group: AMERICAS, region: "BR" }),
  L("it", "it", "it-IT", { group: EUROPE, region: "IT" }),
  L("nl", "nl", "nl-NL", { group: EUROPE, region: "NL" }),
  L("ru", "ru", "ru-RU", { group: EUROPE, region: "RU" }),
  L("uk", "uk", "uk-UA", { group: EUROPE, region: "UA" }),
  L("pl", "pl", "pl-PL", { group: EUROPE, region: "PL" }),
  L("cs", "cs", "cs-CZ", { group: EUROPE, region: "CZ" }),
  L("tr", "tr", "tr-TR", { group: EUROPE, region: "TR" }),
  L("ja", "ja", "ja-JP", { group: ASIA, region: "JP" }),
  L("ko", "ko", "ko-KR", { group: ASIA, region: "KR" }),
  L("zh-CN", "zh-Hans", "zh-CN", { group: ASIA, script: "Hans", region: "CN" }),
  L("zh-TW", "zh-Hant", "zh-TW", { group: ASIA, script: "Hant", region: "TW" }),
  L("ar", "ar", "ar", { direction: "rtl", group: MIDDLE_EAST }),
  L("he", "he", "he", { direction: "rtl", group: MIDDLE_EAST }),
  L("fa", "fa", "fa-IR", { direction: "rtl", group: MIDDLE_EAST, region: "IR" }),
  L("ur", "ur", "ur-PK", { direction: "rtl", group: MIDDLE_EAST, region: "PK" }),
  L("hi", "hi", "hi-IN", { group: ASIA, region: "IN" }),
  L("bn", "bn", "bn-BD", { group: ASIA, region: "BD" }),
  L("id", "id", "id-ID", { group: ASIA, region: "ID" }),
  L("ms", "ms", "ms-MY", { group: ASIA, region: "MY" }),
  L("vi", "vi", "vi-VN", { group: ASIA, region: "VN" }),
  L("th", "th", "th-TH", { group: ASIA, region: "TH" }),
  L("sw", "sw", "sw-KE", { group: AFRICA, region: "KE" }),
];

/**
 * Locales the Language page offers: shipped entries only.
 *
 * Derived rather than hand-maintained. `validate-translations.mjs` asserts that
 * each of these has a real resource directory, so this list can never drift
 * away from what is actually deployed.
 */
export const AVAILABLE_LOCALES: readonly LocaleDefinition[] = LOCALES.filter(
  (l) => l.available,
);

/** Every translation language we ship resources for, de-duplicated. */
export const AVAILABLE_LANGUAGES: readonly string[] = [
  ...new Set(AVAILABLE_LOCALES.map((l) => l.lang)),
];
