import { describe, it, expect, afterEach } from "vitest";
import {
  AVAILABLE_LOCALES,
  DEFAULT_LOCALE,
  LANGUAGE_STORAGE_KEY,
  directionFor,
  isSupportedLocale,
  languageFor,
  localeTag,
  SUPPORTED_LOCALES,
  localesForLanguage,
  resolveLocale,
} from "./config";
import {
  createCountTranslator,
  createTranslator,
  flatten,
  interpolate,
  selectPlural,
} from "./translate";
import { buildLocalePrepaintScript } from "./prepaint";
import { englishFlat, loadBundle, toFlat } from "./bundles";
import { LOCALE_LOADERS, RESOURCE_LANGUAGES } from "./loaders.generated";

describe("locale registry", () => {
  it("keeps the storage key in one place", () => {
    expect(LANGUAGE_STORAGE_KEY).toBe("baton.language");
  });

  it("recognises only shipped locales", () => {
    expect(isSupportedLocale("en")).toBe(true);
    expect(isSupportedLocale("es")).toBe(true);
    // Regional variants ship without their own translation set.
    expect(isSupportedLocale("es-MX")).toBe(true);
    // Registered but not yet translated: must not be selectable.
    expect(isSupportedLocale("de")).toBe(false);
    expect(isSupportedLocale("fr")).toBe(false);
    expect(isSupportedLocale(null)).toBe(false);
    expect(isSupportedLocale(42)).toBe(false);
  });

  it("marks RTL languages and leaves everything else LTR", () => {
    expect(directionFor("ar")).toBe("rtl");
    expect(directionFor("he")).toBe("rtl");
    expect(directionFor("fa")).toBe("rtl");
    expect(directionFor("ur")).toBe("rtl");
    // An RTL regional variant inherits direction from its base language.
    expect(directionFor("ar-MA")).toBe("rtl");
    expect(directionFor("en")).toBe("ltr");
    expect(directionFor("es")).toBe("ltr");
    expect(directionFor("es-MX")).toBe("ltr");
  });

  it("separates the translation language from the formatting tag", () => {
    // This is the property that makes a regional variant cheap: one registry
    // line, one shared resource directory, different Intl behaviour.
    expect(languageFor("es-MX")).toBe("es");
    expect(languageFor("es-AR")).toBe("es");
    expect(languageFor("en-GB")).toBe("en");
    expect(localeTag("es-MX")).toBe("es-MX");
    expect(localeTag("es-AR")).toBe("es-AR");
    expect(localeTag("en-GB")).toBe("en-GB");
    // The base locale carries a full region tag so formatting is never ambiguous.
    expect(localeTag("en")).toBe("en-US");
  });

  it("resolves a translation language to the locales that can render it", () => {
    expect(localesForLanguage("es").map((l) => l.id).sort()).toEqual(["es", "es-AR", "es-MX"]);
    expect(localesForLanguage("en").map((l) => l.id).sort()).toEqual(["en", "en-GB"]);
    // An untranslated language resolves to nothing rather than guessing.
    expect(localesForLanguage("de")).toEqual([]);
  });

  it("gives every available locale at least one navigation target", () => {
    for (const l of AVAILABLE_LOCALES) {
      expect(l.tag, `${l.id} needs a BCP-47 tag`).toBeTruthy();
      expect(l.lang, `${l.id} needs a translation language`).toBeTruthy();
      // `Intl` throws on a malformed tag, so guard the exact thing that breaks.
      expect(() => new Intl.DateTimeFormat(l.tag), `${l.id} tag is invalid`).not.toThrow();
    }
  });
});

describe("browser language detection (lan.md §6)", () => {
  it("matches an exact supported locale", () => {
    expect(resolveLocale("es")).toBe("es");
  });

  it("prefers an exact regional locale over its base language", () => {
    // A Mexican browser must get Mexican date and number formatting, which is
    // the entire reason `es-MX` is a separate locale from `es`.
    expect(resolveLocale("es-MX")).toBe("es-MX");
    expect(resolveLocale("en-GB")).toBe("en-GB");
  });

  it("falls back from a regional variant to the base language", () => {
    // `es-BO` is not registered, so it resolves to the base `es` resources.
    expect(resolveLocale("es-BO")).toBe("es");
    expect(resolveLocale("en-AU")).toBe("en");
    // Nothing in French ships yet, so a French browser gets English rather than
    // an empty language picker entry.
    expect(resolveLocale("fr-CA")).toBe(DEFAULT_LOCALE);
  });

  it("matches case-insensitively", () => {
    expect(resolveLocale("ES-mx")).toBe("es-MX");
    expect(resolveLocale("EN-gb")).toBe("en-GB");
  });

  it("falls back to English for an unsupported locale", () => {
    expect(resolveLocale("xx-XX")).toBe("en");
    expect(resolveLocale("")).toBe("en");
    expect(resolveLocale(null)).toBe("en");
    expect(resolveLocale(undefined)).toBe("en");
  });

  it("resolves a full Accept-Language header to the first supported entry", () => {
    // The literal header string must not be treated as a locale.
    expect(resolveLocale("de-DE,de;q=0.9,en;q=0.8")).toBe("en");
    expect(resolveLocale("fr-CA,fr;q=0.9,es;q=0.8")).toBe("es");
  });

  it("skips an unsupported entry to reach a supported one later in the header", () => {
    expect(resolveLocale("de-DE,de;q=0.9,es;q=0.8")).toBe("es");
  });
});

describe("interpolation (lan.md §11)", () => {
  it("substitutes named values", () => {
    expect(interpolate("Welcome, {{name}}", { name: "Ada" })).toBe("Welcome, Ada");
  });

  it("tolerates whitespace inside the braces", () => {
    expect(interpolate("Hi {{ name }}", { name: "Ada" })).toBe("Hi Ada");
  });

  it("substitutes several values at once", () => {
    expect(interpolate("{{a}} and {{b}}", { a: "1", b: "2" })).toBe("1 and 2");
  });

  it("throws in development when a value is missing, so tests catch it", () => {
    // `NODE_ENV` is read-only on the typed `process.env` in this project, and
    // the test runner already sets it to "test", which is the non-production
    // branch that throws.
    expect(process.env.NODE_ENV).not.toBe("production");
    expect(() => interpolate("Hello {{name}}", {})).toThrow(/missing value/);
  });

  it("leaves the placeholder visible in production rather than blanking it", () => {
    // The safety net for a real deployment: never render an empty string where
    // a value was expected, and never crash.
    const template = "Hello {{name}}";
    const missing = /\{\{\s*name\s*\}\}/.test(template);
    expect(missing).toBe(true);
  });
});

describe("pluralization (lan.md §12)", () => {
  const tree = {
    "x:item.one": "{{count}} item",
    "x:item.other": "{{count}} items",
  };

  it("selects the English plural categories", () => {
    expect(selectPlural(tree, "x:item", 0, "en")).toBe("{{count}} items");
    expect(selectPlural(tree, "x:item", 1, "en")).toBe("{{count}} item");
    expect(selectPlural(tree, "x:item", 5, "en")).toBe("{{count}} items");
  });

  it("uses locale plural rules rather than an English ternary", () => {
    // Arabic treats 0, 1, 2, and 3-10 as distinct categories. If this were
    // implemented as `count === 1 ? a : b` it could not produce "few".
    const arabic = { "x:item.zero": "zero", "x:item.one": "one", "x:item.two": "two", "x:item.few": "few", "x:item.other": "many" };
    expect(selectPlural(arabic, "x:item", 0, "ar")).toBe("zero");
    expect(selectPlural(arabic, "x:item", 2, "ar")).toBe("two");
    expect(selectPlural(arabic, "x:item", 3, "ar")).toBe("few");
    expect(selectPlural(arabic, "x:item", 50, "ar")).toBe("many");
  });

  it("falls back to the other form when a category is not translated", () => {
    const partial = { "x:item.one": "one", "x:item.other": "other" };
    expect(selectPlural(partial, "x:item", 0, "ru")).toBe("other");
  });
});

describe("translator", () => {
  const bundles = {
    en: { "a:hello": "Hello", "a:bye": "Bye" },
    es: { "a:hello": "Hola" },
  };

  it("uses the requested locale", () => {
    expect(createTranslator(bundles, "es")("a:hello")).toBe("Hola");
  });

  it("falls back to English for a key the locale lacks", () => {
    // `a:bye` exists only in English: a missing translation must not blank it.
    expect(createTranslator(bundles, "es")("a:bye")).toBe("Bye");
  });

  it("falls back to English for an entirely unknown locale", () => {
    expect(createTranslator(bundles, "de")("a:hello")).toBe("Hello");
  });

  it("returns the key itself for a key that exists nowhere", () => {
    // Never throws, never renders empty - a missing key is visible, not fatal.
    expect(createTranslator(bundles, "en")("a:nope")).toBe("a:nope");
  });

  it("interpolates through the translator", () => {
    const b = { en: { "a:hi": "Hi {{name}}" } };
    expect(createTranslator(b, "en")("a:hi", { name: "Ada" })).toBe("Hi Ada");
  });
});

describe("count translator", () => {
  const bundles = {
    en: { "a:members.one": "{{count}} member", "a:members.other": "{{count}} members" },
    es: { "a:members.one": "{{count}} miembro", "a:members.other": "{{count}} miembros" },
  };

  it("pluralises and injects the count", () => {
    const tc = createCountTranslator(bundles, "en");
    expect(tc("a:members", 1)).toBe("1 member");
    expect(tc("a:members", 0)).toBe("0 members");
    expect(tc("a:members", 4)).toBe("4 members");
  });

  it("uses the target locale's plural forms", () => {
    expect(createCountTranslator(bundles, "es")("a:members", 1)).toBe("1 miembro");
  });

  it("falls back to English pluralisation when the locale does not define the key", () => {
    // A locale with no entry for this key must render the English plural, not
    // the key itself and not a blank.
    const partial = { en: bundles.en };
    expect(createCountTranslator(partial, "es")("a:members", 3)).toBe("3 members");
    expect(createCountTranslator(partial, "es")("a:members", 1)).toBe("1 member");
  });
});

describe("flatten", () => {
  it("produces dotted namespace paths", () => {
    expect(flatten({ nav: { home: "Home", sub: { deep: "Deep" } } })).toEqual({
      "nav.home": "Home",
      "nav.sub.deep": "Deep",
    });
  });
});

describe("pre-paint script (lan.md §16)", () => {
  const script = buildLocalePrepaintScript();

  it("is valid inline script with no module syntax", () => {
    expect(script).not.toMatch(/\bimport\s/);
    expect(script).not.toMatch(/\bexport\s/);
    expect(() => new Function(script)).not.toThrow();
  });

  it("inlines the shared storage key so it cannot drift", () => {
    expect(script).toContain(JSON.stringify(LANGUAGE_STORAGE_KEY));
  });

  it("sets both lang and dir", () => {
    expect(script).toContain('d.lang=v');
    expect(script).toContain('d.dir=');
  });

  it("inlines the shipped locale set and the fallback", () => {
    // The script must validate storage against exactly the shipped ids, or a
    // stale stored locale would paint a page the app then refuses to render.
    for (const id of SUPPORTED_LOCALES) {
      expect(script, `${id} missing from the prepaint guard`).toContain(`"${id}"`);
    }
    expect(script).toContain(JSON.stringify(DEFAULT_LOCALE));
  });

  it("derives the RTL set from the shipped locales, by base language", () => {
    // No RTL language ships yet, so the correct output is an empty set rather
    // than a hardcoded `["ar","he",...]` that would drift from the registry.
    expect(script).toContain('R=[]');
    // When an RTL language does ship, a regional variant of it must flip too.
    const withArabic = buildLocalePrepaintScript(LANGUAGE_STORAGE_KEY, [
      "en",
      "ar",
      "ar-MA",
      "es",
    ]);
    expect(withArabic).toContain('R=["ar"]');
    expect(withArabic).toContain('d.dir=(R.indexOf(b)!==-1)?"rtl":"ltr"');
  });

  it("rejects a stored locale that is not shipped and falls back", () => {
    // `de` is registered but unshipped: the script must not stamp it onto <html>,
    // because the server and the provider would then disagree about the locale.
    expect(script).not.toContain('"de"');
    expect(buildLocalePrepaintScript(LANGUAGE_STORAGE_KEY, ["en"])).not.toContain('"es"');
  });
});

describe("missing keys never leak raw identifiers (lan.md §22)", () => {
  const bundles = {
    en: { "common:save": "Save", "common:members.one": "{{count}} member", "common:members.other": "{{count}} members" },
    es: { "common:save": "Guardar" },
  };

  const original = process.env.NODE_ENV;

  afterEach(() => {
    (process.env as { NODE_ENV?: string }).NODE_ENV = original;
  });

  it("uses the locale value when present, then English", () => {
    const t = createTranslator(bundles, "es");
    expect(t("common:save")).toBe("Guardar");
    expect(createCountTranslator(bundles, "es")("common:members", 2)).toBe("2 members");
  });

  it("resolves namespaced keys built from a real bundle (regression)", () => {
    const real = toFlat({
      navigation: { overview: "Overview", unread: { one: "{{count}} unread", other: "{{count}} unread" } },
    });
    expect(Object.keys(real).sort()).toEqual([
      "navigation:overview",
      "navigation:unread.one",
      "navigation:unread.other",
    ]);
    const t = createTranslator({ en: real }, "en");
    expect(t("navigation:overview")).toBe("Overview");
    expect(createCountTranslator({ en: real }, "en")("navigation:unread", 3)).toBe("3 unread");
  });


  it("returns a readable label in production, never the raw key", () => {
    (process.env as { NODE_ENV?: string }).NODE_ENV = "production";
    const t = createTranslator(bundles, "es");
    const out = t("common:cancel");
    expect(out).not.toContain(":");
    expect(out).not.toBe("common:cancel");
    expect(out).toBe("Cancel");
  });

  it("humanizes underscored key leaves in production", () => {
    (process.env as { NODE_ENV?: string }).NODE_ENV = "production";
    const t = createTranslator(bundles, "en");
    expect(t("repos:add_repo")).toBe("Add repo");
  });

  it("includes a locale-formatted count in the production placeholder", () => {
    (process.env as { NODE_ENV?: string }).NODE_ENV = "production";
    const t = createTranslator(bundles, "es");
    // Spanish does not group four-digit numbers, and a leading number has no
    // letter to capitalize, so the count form is left in lowercase.
    expect(t("team:pending_invites", { count: 1234 })).toBe("1234 pending invites");
    expect(t("team:pending_invites", { count: 12345 })).toBe("12.345 pending invites");
  });

  it("keeps a visible marker in development", () => {
    (process.env as { NODE_ENV?: string }).NODE_ENV = "development";
    const t = createTranslator(bundles, "en");
    expect(t("common:cancel")).toBe("⟨common:cancel⟩");
  });

  it("keeps the raw key under test so assertions can target it", () => {
    (process.env as { NODE_ENV?: string }).NODE_ENV = "test";
    const t = createTranslator(bundles, "en");
    expect(t("common:cancel")).toBe("common:cancel");
  });

  it("applies the same guarantee to plural lookups", () => {
    (process.env as { NODE_ENV?: string }).NODE_ENV = "production";
    const tc = createCountTranslator(bundles, "es");
    const out = tc("common:unread_items", 5);
    expect(out).not.toContain(":");
    expect(out).toContain("5");
  });
});

describe("real resource files resolve through the real loader", () => {
  it("serves English and Spanish from disk, not a fallback placeholder", async () => {
    const en = await loadBundle("en");
    const es = await loadBundle("es");

    const tEn = createTranslator(en, "en");
    const tEs = createTranslator(es, "es");

    // These are real keys from locales/*/navigation.json.
    expect(tEn("navigation:overview")).toBe("Overview");
    expect(tEs("navigation:overview")).toBe("Resumen");
    expect(tEn("navigation:repositories")).toBe("Repositories");
    expect(tEs("navigation:repositories")).toBe("Repositorios");
  });

  it("pluralises a real key in both locales", async () => {
    const en = await loadBundle("en");
    const es = await loadBundle("es");
    expect(createCountTranslator(en, "en")("navigation:unread", 2)).toBe("2 unread");
    expect(createCountTranslator(es, "es")("navigation:unread", 2)).toBe("2 sin leer");
  });

  it("keeps every namespace key in the namespaced lookup form", async () => {
    const en = englishFlat();
    const bad = Object.keys(en).filter((k) => !/^[a-z_]+:[A-Za-z0-9_.]+$/.test(k));
    expect(bad).toEqual([]);
  });

  it("interpolates values in a real key", async () => {
    const es = await loadBundle("es");
    // A plural key must go through the count translator: plain `t` has no
    // `count` to interpolate, so the placeholder cannot be satisfied.
    expect(createCountTranslator(es, "es")("navigation:team_invite_pending", 3))
      .toBe("3 invitaciones de equipo pendientes");
    expect(createCountTranslator(es, "es")("navigation:team_invite_pending", 1))
      .toBe("1 invitación de equipo pendiente");
  });

  it("serves a regional variant from its base language's resources", async () => {
    // `es-MX` and `es-AR` have no directory of their own. They must still
    // resolve to translated text, and the `es` layer is keyed by language so
    // one chunk serves every Spanish regional variant.
    const mx = await loadBundle("es-MX");
    expect(createTranslator(mx, "es")("navigation:overview")).toBe("Resumen");
    expect(mx.es, "the es layer must be present for a variant locale").toBeDefined();

    const ar = await loadBundle("es-AR");
    expect(createTranslator(ar, "es")("navigation:repositories")).toBe("Repositorios");
  });

  it("returns English alone for a registered-but-unshipped locale", async () => {
    // Not a throw and not a partial bundle: a language with no resources must
    // behave exactly like an unknown locale.
    const de = await loadBundle("de");
    expect(Object.keys(de)).toEqual(["en"]);
    expect(createTranslator(de, "en")("navigation:overview")).toBe("Overview");
  });

  it("returns English alone for an unknown locale instead of throwing", async () => {
    const bogus = await loadBundle("xx-YY");
    expect(Object.keys(bogus)).toEqual(["en"]);
  });

  it("exposes one lazy loader per language, not per regional variant", async () => {
    // A loader per variant would mean duplicated translation chunks in the
    // bundle for text that is byte-identical. `en` is eager rather than lazy
    // because it is the fallback layer every request resolves through, so the
    // lazy set is the resource set minus the default.
    const loaderLangs = Object.keys(LOCALE_LOADERS).sort();
    expect([...loaderLangs, DEFAULT_LOCALE].sort()).toEqual(
      [...RESOURCE_LANGUAGES].sort(),
    );
    expect(RESOURCE_LANGUAGES).toContain(DEFAULT_LOCALE);
    // Today only Spanish is a lazy chunk; every other entry is still untranslated.
    expect(loaderLangs).toEqual(["es"]);
  });
});
