"use client";

/**
 * Language picker (lan.md §4, §5, §14, §15, §19, §20, §21, §22, §23).
 *
 * Search is a pure client-side ranked filter over the registry, so it is
 * instant and needs no server request. It matches native name, English name,
 * language code, locale id, and locale tag, and it is diacritic-insensitive so
 * "espanol" finds "Español".
 *
 * Selection uses real buttons rather than a `<select>`, because each row
 * carries a native name, an English name, a code badge, a region, and a writing
 * direction, and needs to expose its selected state to assistive technology.
 *
 * Regional variants (`pt-BR`, `pt-PT`) are offered as distinct rows because
 * they format dates and currency differently, which is the whole reason the
 * registry separates a translation language from a format locale.
 */

import { useDeferredValue, useId, useMemo, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { searchLanguages, type LanguageEntry } from "@/lib/i18n/languages";
import { IconCheck, IconGlobe, IconSearch, IconX } from "@/components/icons";

/** Strips diacritics so "espanol" finds "Español". */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

const GROUP_ORDER = ["europe", "americas", "asia", "middle-east", "africa"] as const;

export function LanguagePicker({ languages }: { languages: LanguageEntry[] }) {
  const { locale, setLocale, t, tc, loading, saveError } = useI18n();
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const listId = useId();
  const searchId = useId();
  const statusId = useId();
  const searchRef = useRef<HTMLInputElement>(null);

  // The server passes the registry; only shipped locales are offered. A locale
  // with no resources would leave the user reading English behind a local flag.
  const available = useMemo(() => languages.filter((l) => l.available), [languages]);

  const filtered = useMemo(() => {
    const q = deferred.trim();
    if (!q) return available;
    // Ranked search first, then a diacritic-folded pass so accented languages
    // are reachable by their unaccented spelling too.
    const ranked = searchLanguages(q, available);
    const seen = new Set(ranked.map((l) => l.id));
    const folded = fold(q);
    const extra = available.filter(
      (l) =>
        !seen.has(l.id) &&
        (fold(l.nativeName).includes(folded) || fold(l.englishName).includes(folded)),
    );
    return [...ranked, ...extra];
  }, [available, deferred]);

  // Group only when the list is long enough that scanning needs the help, and
  // only when the user has not narrowed to a search.
  const grouped = useMemo(() => {
    if (query.trim() || filtered.length < 8) return null;
    const byGroup = new Map<string, LanguageEntry[]>();
    for (const l of filtered) {
      const list = byGroup.get(l.group) ?? [];
      list.push(l);
      byGroup.set(l.group, list);
    }
    return GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => ({
      group: g,
      items: byGroup.get(g)!,
    }));
  }, [filtered, query]);

  const current = available.find((l) => l.id === locale);
  const announce = (l: LanguageEntry) => t("language:changed", { name: l.nativeName });

  const renderRow = (l: LanguageEntry) => {
    const selected = l.id === locale;
    return (
      <li key={l.id}>
        <button
          type="button"
          onClick={() => setLocale(l.id)}
          aria-pressed={selected}
          aria-label={t("language:select", { name: l.nativeName })}
          className={[
            "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-start transition-colors",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400",
            selected
              ? "border-brand-500/40 bg-brand-500/10"
              : "border-white/[0.07] bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]",
          ].join(" ")}
        >
          <span
            className={[
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border font-mono text-[10px] font-semibold",
              selected
                ? "border-brand-500/40 bg-brand-500/15 text-brand-200"
                : "border-white/[0.08] bg-ink-850 text-ink-400",
            ].join(" ")}
          >
            {l.badge}
          </span>

          <span className="min-w-0 flex-1">
            {/* Native name is the primary label, per lan.md §4. */}
            <span className="block truncate text-sm font-medium text-white">{l.nativeName}</span>
            <span className="flex items-center gap-1.5 text-xs text-ink-500">
              <span className="truncate">{l.englishName}</span>
              {l.id !== l.lang ? <span className="truncate">· {l.tag}</span> : null}
              {/* Direction is stated in text, not only by layout (lan.md §15). */}
              {l.direction === "rtl" ? (
                <span className="shrink-0 rounded border border-white/[0.08] px-1 font-mono text-[9px] uppercase">
                  {t("language:rtl_badge")}
                </span>
              ) : null}
            </span>
          </span>

          {selected ? (
            <>
              <IconCheck className="h-4 w-4 shrink-0 text-brand-300" />
              <span className="sr-only">{t("language:selected")}</span>
            </>
          ) : null}
        </button>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">
            {t("language:current")}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-white">
            <IconGlobe className="h-4 w-4 shrink-0 text-ink-500" />
            {current ? (
              <>
                <span className="font-medium">{current.nativeName}</span>
                <span className="text-ink-500">
                  · {current.englishName} · {current.badge}
                </span>
                {current.direction === "rtl" ? (
                  <span className="rounded border border-white/[0.08] px-1.5 py-0.5 font-mono text-[9px] uppercase text-ink-400">
                    {t("language:rtl_badge")}
                  </span>
                ) : null}
              </>
            ) : (
              <span className="text-ink-500">{t("common:unknown")}</span>
            )}
          </p>
        </div>

        {/* Search: labelled, clearable, and Escape-resettable. */}
        <div className="relative w-full sm:w-72">
          <label htmlFor={searchId} className="sr-only">
            {t("language:search_label")}
          </label>
          <span className="pointer-events-none absolute inset-inline-start-3 top-1/2 -translate-y-1/2 text-ink-500">
            <IconSearch className="h-4 w-4" />
          </span>
          <input
            ref={searchRef}
            id={searchId}
            type="search"
            role="searchbox"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) {
                e.preventDefault();
                setQuery("");
              }
            }}
            placeholder={t("language:search_placeholder")}
            aria-describedby={statusId}
            autoComplete="off"
            spellCheck={false}
            className="input w-full ps-9 pe-9"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                searchRef.current?.focus();
              }}
              className="absolute inset-inline-end-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-500 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400"
            >
              <IconX className="h-3.5 w-3.5" />
              <span className="sr-only">{t("language:clear_search")}</span>
            </button>
          ) : null}
        </div>
      </div>

      {/* Result count, announced politely so a screen reader hears the change
          after each keystroke without the list stealing focus. */}
      <p id={statusId} role="status" aria-live="polite" className="text-xs text-ink-500">
        {tc("language:results", filtered.length)}
        {loading ? ` · ${t("common:loading")}` : ""}
      </p>

      {saveError ? (
        <p
          role="alert"
          className="rounded-lg border border-warn-500/30 bg-warn-500/10 px-3 py-2 text-xs text-warn-300"
        >
          {t(saveError)}
        </p>
      ) : null}

      {filtered.length === 0 ? (
        <div className="card px-5 py-10 text-center">
          <p className="text-sm text-ink-300">{t("language:no_results")}</p>
          <p className="mt-1 text-xs text-ink-500">{t("language:no_results_hint")}</p>
        </div>
      ) : grouped ? (
        <div id={listId} className="flex flex-col gap-6">
          {grouped.map(({ group, items }) => (
            <section key={group} aria-labelledby={`${listId}-${group}`}>
              <h3
                id={`${listId}-${group}`}
                className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-500"
              >
                {t(`language:group_${group}`)}
              </h3>
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {items.map(renderRow)}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <ul
          id={listId}
          aria-label={t("language:language_list")}
          className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3"
        >
          {filtered.map(renderRow)}
        </ul>
      )}

      {/* Announce the outcome of a change without moving focus. */}
      <p role="status" aria-live="polite" className="sr-only">
        {current ? announce(current) : ""}
      </p>
    </div>
  );
}
