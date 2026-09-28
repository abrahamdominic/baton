/**
 * Language display metadata for the selector (lan.md §3, §4, §5).
 *
 * Native and English names come from `Intl.DisplayNames`, which is CLDR data
 * shipped with the runtime. That is deliberate: a hand-written table of 100+
 * languages is the kind of thing that silently contains a misspelling and never
 * gets noticed, and it cannot be corrected without shipping a code change.
 *
 * The names are therefore *derived*, and the registry decides which languages
 * exist at all.
 */

import { AVAILABLE_LOCALES, type LocaleDefinition } from "./config";

export interface LanguageEntry extends LocaleDefinition {
  /** Name of the language in the language itself: "Español". */
  nativeName: string;
  /** Name of the language in English: "Spanish". */
  englishName: string;
  /** Uppercase badge shown next to the name: "ES", "PT-BR". */
  badge: string;
  /** Region label used for the accessible flag description. */
  regionLabel: string;
}

let displayNames: { en: Intl.DisplayNames; native: Map<string, Intl.DisplayNames> } | null = null;

function getDisplayNames() {
  if (displayNames) return displayNames;
  let en: Intl.DisplayNames;
  try {
    en = new Intl.DisplayNames(["en"], { type: "language" });
  } catch {
    // Runtime without full ICU. Degrade to the raw code rather than crashing
    // the Language page; the rest of the selector still works.
    en = null as unknown as Intl.DisplayNames;
  }
  const native = new Map<string, Intl.DisplayNames>();
  displayNames = { en, native };
  return displayNames;
}

function makeDisplayNames(locale: string): Intl.DisplayNames | null {
  const { native } = getDisplayNames();
  const cached = native.get(locale);
  if (cached !== undefined) return cached;
  let made: Intl.DisplayNames | null = null;
  try {
    made = new Intl.DisplayNames([locale], { type: "language" });
  } catch {
    made = null;
  }
  native.set(locale, made as unknown as Intl.DisplayNames);
  return made;
}

function englishName(tag: string): string {
  try {
    return getDisplayNames().en?.of(tag) ?? tag;
  } catch {
    return tag;
  }
}

function nativeName(tag: string, lang: string): string {
  // Prefer the language in its own locale, then in its default region.
  for (const candidate of [lang, tag]) {
    const dn = makeDisplayNames(candidate);
    if (!dn) continue;
    try {
      const name = dn.of(tag) ?? dn.of(lang);
      if (name) return name;
    } catch {
      // Unsupported language subtag; try the next candidate.
    }
  }
  return englishName(tag);
}

function build(def: LocaleDefinition): LanguageEntry {
  // `Intl.DisplayNames` wants a language tag, not a full locale with region, so
  // a scripted variant resolves by its script subtag (`zh-Hans`, `zh-Hant`)
  // rather than by the region that only affects formatting.
  const languageTag = def.script ? `${def.lang}-${def.script}` : def.lang;
  return {
    ...def,
    nativeName: nativeName(languageTag, def.lang),
    englishName: englishName(languageTag),
    badge: def.id.toUpperCase(),
    regionLabel: def.region ?? def.tag.split("-")[1] ?? def.lang.toUpperCase(),
  };
}

/** Every shipped locale, with display metadata attached. */
export const LANGUAGES: LanguageEntry[] = AVAILABLE_LOCALES.map(build).sort((a, b) =>
  a.nativeName.localeCompare(b.nativeName, "en"),
);

/** Shipped locales only, in registry order (for locale-sensitive sorting). */
export const LANGUAGES_IN_REGISTRY_ORDER: LanguageEntry[] = AVAILABLE_LOCALES.map(build);

/**
 * Ranked search over native name, English name, code, and locale tag
 * (lan.md §5). Pure and synchronous so the page needs no server round trip.
 *
 * An exact code match ranks first, because typing `pt` should surface `pt-BR`
 * before every language whose English name merely contains those letters.
 */
export function searchLanguages(query: string, entries = LANGUAGES): LanguageEntry[] {
  const q = query.trim().toLowerCase().replace(/^["']|["']$/g, "");
  if (!q) return entries;

  const scored: Array<{ entry: LanguageEntry; score: number }> = [];
  for (const entry of entries) {
    const native = entry.nativeName.toLowerCase();
    const english = entry.englishName.toLowerCase();
    const code = entry.lang.toLowerCase();
    const id = entry.id.toLowerCase();
    const badge = entry.badge.toLowerCase();

    let score = -1;
    if (id === q || code === q || badge === q) score = 0;
    else if (native.startsWith(q)) score = 1;
    else if (english.startsWith(q)) score = 2;
    else if (id.startsWith(q) || code.startsWith(q)) score = 3;
    else if (native.includes(q)) score = 4;
    else if (english.includes(q)) score = 5;
    else if (id.includes(q)) score = 6;

    if (score >= 0) scored.push({ entry, score });
  }

  return scored
    .sort((a, b) => a.score - b.score || a.entry.nativeName.localeCompare(b.entry.nativeName, "en"))
    .map((s) => s.entry);
}

/** Look up a display entry by locale id. */
export function languageEntry(id: string): LanguageEntry | undefined {
  return LANGUAGES_IN_REGISTRY_ORDER.find((l) => l.id === id);
}
