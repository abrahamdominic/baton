/**
 * Pre-paint locale script (lan.md §16).
 *
 * Runs synchronously in <head>, before React hydrates, and stamps `lang`/`dir`
 * onto <html> from local storage. Without this the first paint is whatever the
 * server sent and the correct language arrives a frame later, which is the
 * visible "English -> Spanish" flash the spec forbids.
 *
 * Kept as a string because it is inlined into the document. Two constraints
 * follow from that and are load-bearing:
 *  - it must not use `import`, `export`, or top-level await
 *  - the storage key, the supported set, and the RTL set are all interpolated
 *    from shared constants so they can never drift from the provider
 *
 * The resolution logic here is a deliberate *simplification* of
 * `config.ts resolveLocale`: it only reads storage and then a base language
 * from `navigator.language`. The full exact-then-tag-then-base ladder lives in
 * `config.ts` and runs on the server. Duplicating the whole thing here would be
 * the kind of "temporary parallel implementation" that silently diverges, so
 * this script stays small and the authoritative list of valid ids is passed in.
 */

import {
  DEFAULT_LOCALE,
  LANGUAGE_STORAGE_KEY,
  RTL_LANGS,
  SUPPORTED_LOCALES,
  AVAILABLE_LOCALES,
} from "@/lib/i18n/config";

export function buildLocalePrepaintScript(
  storageKey: string = LANGUAGE_STORAGE_KEY,
  supported: readonly string[] = SUPPORTED_LOCALES,
  fallback: string = DEFAULT_LOCALE,
): string {
  // Only shipped locale ids are valid. The RTL set is `RTL_LANGS` *intersected*
  // with the shipped base languages - not the shipped base languages themselves,
  // which would mark every shipped language right-to-left. Matching on the base
  // means a regional variant of an RTL language (`ar-MA`) inherits direction for
  // free, with no second entry to keep in sync.
  const ids = [...supported];
  const rtl = [...RTL_LANGS].filter((base) =>
    ids.some((id) => id === base || id.startsWith(`${base}-`)),
  );
  const valid = ids.includes(fallback) ? ids : [fallback, ...ids];

  return `(function(){try{
var K=${JSON.stringify(storageKey)},S=${JSON.stringify(valid)},R=${JSON.stringify(rtl)},F=${JSON.stringify(fallback)};
var v=null;try{v=window.localStorage.getItem(K);}catch(e){}
if(!v||S.indexOf(v)===-1){
v=(navigator.language||"").toLowerCase();
if(S.indexOf(v)===-1){v=v.split("-")[0];}
if(S.indexOf(v)===-1){v=F;}
}
var b=v.split("-")[0],d=document.documentElement;
d.lang=v;d.dir=(R.indexOf(b)!==-1)?"rtl":"ltr";
d.setAttribute("data-locale",v);
}catch(e){}})();`;
}

/** Locales the settings page and tests use to assert what is actually shipped. */
export const SHIPPED_LOCALES: readonly string[] = AVAILABLE_LOCALES.map((l) => l.id);
