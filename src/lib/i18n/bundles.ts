/**
 * Translation resource loading (lan.md §17, §18).
 *
 * Isomorphic on purpose: the same loader runs during SSR and in the browser, so
 * a page cannot render in one language and hydrate in another.
 *
 * Bundle splitting comes from the generated `LOCALE_LOADERS` map, where each
 * language is a `import()` behind a literal specifier. English is imported
 * eagerly because it is the fallback layer for every request, so a client that
 * never leaves English never downloads another language, and a client that does
 * switch fetches exactly one chunk.
 *
 * The generated file is rebuilt by `npm run i18n:generate`; nothing here needs
 * editing to add a language.
 */

import { DEFAULT_LOCALE, languageFor } from "./config";
import { flatten, type FlatTree, type TranslationTree } from "./translate";
import {
  EN_BUNDLE,
  LOCALE_LOADERS,
  NAMESPACES,
  RESOURCE_LANGUAGES,
} from "./loaders.generated";

export { NAMESPACES, EN_BUNDLE };

/**
 * Flattens a namespace tree into `namespace:key` lookup keys.
 *
 * The separator is the important part. `flatten` joins a path with "." to build
 * a nested-object path, but the public lookup key uses ":", and so do the
 * validator, the missing-key report, and every `t()` call site. Emitting "." here
 * made every lookup miss and silently degraded the entire UI to fallbacks, which
 * is invisible in review because the fallback still produced plausible English.
 */
export function toFlat(tree: TranslationTree): FlatTree {
  const flat: FlatTree = {};
  for (const [ns, nsTree] of Object.entries(tree)) {
    // A namespace is a nested object; a bare string here means the resource
    // file has the wrong shape, which the validator reports as an error.
    if (typeof nsTree === "string") continue;
    for (const [path, value] of Object.entries(flatten(nsTree))) {
      flat[`${ns}:${path}`] = value;
    }
  }
  return flat;
}

let enFlatCache: FlatTree | null = null;
const langCache = new Map<string, FlatTree>();

/** Flattened English. Cached because every request falls back through it. */
export function englishFlat(): FlatTree {
  if (!enFlatCache) enFlatCache = toFlat(EN_BUNDLE);
  return enFlatCache;
}

async function loadLanguage(lang: string): Promise<FlatTree | null> {
  const cached = langCache.get(lang);
  if (cached) return cached;

  const loader = LOCALE_LOADERS[lang];
  if (!loader) return null;

  try {
    const flat = toFlat(await loader());
    langCache.set(lang, flat);
    return flat;
  } catch {
    // A chunk that fails to load must not take the page down (lan.md §18).
    return null;
  }
}

/**
 * Loads a locale and returns English as the fallback layer beneath it.
 *
 * `locale` is a locale id, not a language: `pt-BR` and `pt-PT` both resolve to
 * the `pt` resources and then format through their own BCP-47 tag, so a
 * regional variant costs a registry entry rather than a second copy of the
 * translation set.
 *
 * Every failure mode - unregistered locale, missing directory, chunk error -
 * resolves to English alone rather than throwing.
 */
export async function loadBundle(locale: string): Promise<Record<string, FlatTree>> {
  const en = englishFlat();
  if (locale === DEFAULT_LOCALE) return { en };

  const lang = languageFor(locale);
  const flat = await loadLanguage(lang);
  if (!flat) return { en };
  return { en, [lang]: flat };
}

/** Languages that have resource directories, used by the validator and tests. */
export const RESOURCE_LANGUAGES_LIST: readonly string[] = RESOURCE_LANGUAGES;
