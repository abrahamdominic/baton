"use client";

/**
 * Client translation context (lan.md §6, §7, §8, §9, §16, §24).
 *
 * Switching language updates React state and re-renders. There is no reload, no
 * redirect, and no route change: `t` is a closure over React state, so every
 * component that reads it re-renders in the same tick.
 *
 * Precedence, per lan.md §24:
 *   1. authenticated account preference (passed in as `accountLocale`)
 *   2. local storage (set by an earlier explicit choice on this device)
 *   3. browser language
 *   4. English
 *
 * The subtlety is that a *stale* local value must not beat a *newer* account
 * value on sign-in. `accountLocale` therefore wins whenever it is present and
 * the local value was never explicitly set, and `explicitLocal` tracks whether
 * the local value came from a deliberate choice or from passive browser
 * detection - only a deliberate choice is allowed to survive sign-in.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_LOCALE,
  LANGUAGE_STORAGE_KEY,
  directionFor,
  isSupportedLocale,
  localeTag,
  resolveLocale,
  type Locale,
} from "./config";
import { loadBundle } from "./bundles";
import { createCountTranslator, createTranslator, type FlatTree } from "./translate";
import {
  formatBytes,
  formatCompact,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatRelative,
  formatTime,
} from "./format";

export interface I18nContextValue {
  locale: Locale;
  direction: "ltr" | "rtl";
  t: (key: string, values?: Record<string, string | number>) => string;
  tc: (key: string, count: number, values?: Record<string, string | number>) => string;
  setLocale: (locale: Locale) => void;
  /** False while a newly selected locale's chunk is still in flight. */
  loading: boolean;
  /** Set when the account save failed, so the UI can explain without blocking. */
  saveError: string | null;
  reportSaveError: (key: string | null) => void;
  /** Locale-aware number/date/currency helpers (lan.md §13). */
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatDate: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
  formatCurrency: (cents: number, currency: string) => string;
  formatTime: (v: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
  formatDateTime: (v: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
  formatRelative: (v: Date | string | number) => string;
  formatPercent: (v: number, options?: Intl.NumberFormatOptions) => string;
  formatCompact: (v: number) => string;
  formatBytes: (v: number) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function readStoredLocale(): { locale: Locale; explicit: boolean } | null {
  try {
    const raw = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (raw && isSupportedLocale(raw)) return { locale: raw, explicit: true };
  } catch {
    // Private mode, disabled storage, or a sandboxed iframe. Detection below
    // still produces a working language.
  }
  return null;
}

export function I18nProvider({
  children,
  initialLocale,
  bundles,
  accountLocale,
  persist,
}: {
  children: ReactNode;
  initialLocale: Locale;
  bundles: Record<string, FlatTree>;
  /** The signed-in user's saved preference, or null when signed out. */
  accountLocale?: Locale | null;
  /** Called after the UI and local storage have already updated. */
  persist?: (locale: Locale) => void | Promise<void>;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const [current, setCurrent] = useState<Record<string, FlatTree>>(bundles);
  const [loading, setLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const mounted = useRef(false);

  const t = useMemo(
    () => createTranslator(current, locale),
    [current, locale],
  );
  const tc = useMemo(
    () => createCountTranslator(current, locale),
    [current, locale],
  );

  // Keep <html lang> and dir in step, which is what makes RTL and screen-reader
  // pronunciation correct (lan.md §14, §15).
  useEffect(() => {
    const root = document.documentElement;
    root.lang = localeTag(locale);
    root.dir = directionFor(locale);
  }, [locale]);

  // One-time hydration. The server already rendered `initialLocale`, so this
  // only ever reconciles a browser preference that the server could not know
  // about. It never re-runs, which is what stops browser detection from
  // overriding a later explicit choice.
  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;

    if (accountLocale && isSupportedLocale(accountLocale)) {
      // Account preference wins over a browser-detected local value, but not
      // over a local value the user deliberately picked on this device.
      const stored = readStoredLocale();
      if (!stored?.explicit) {
        setLocaleState(accountLocale);
        if (stored) return;
        try {
          window.localStorage.setItem(LANGUAGE_STORAGE_KEY, accountLocale);
        } catch {
          /* storage unavailable; account preference still applies this session */
        }
      }
      return;
    }

    const stored = readStoredLocale();
    if (stored) {
      setLocaleState(stored.locale);
      return;
    }

    const detected = resolveLocale(navigator.language);
    setLocaleState(detected);
  }, [accountLocale]);

  // Load a locale's chunk when it is not the one already present. English is
  // bundled, so the common path does no extra work at all.
  useEffect(() => {
    if (bundles[locale]) return;
    let cancelled = false;
    setLoading(true);
    loadBundle(locale)
      .then((next) => {
        if (cancelled) return;
        setCurrent((prev) => ({ ...prev, ...next }));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `bundles` is the SSR payload and is intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  const setLocale = useCallback(
    (next: Locale) => {
      if (!isSupportedLocale(next)) return;

      // 1. UI updates now, in this tick. No reload, no redirect (lan.md §9).
      setLocaleState(next);
      // 2. Local persistence, immediately, so a refresh keeps the choice.
      try {
        window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
      } catch {
        /* non-fatal: the session and the account still hold the choice */
      }
      setSaveError(null);

      // 3. Account persistence is fire-and-forget. The UI must never block on
      //    the database (lan.md §8).
      if (!persist) return;
      void Promise.resolve(persist(next))
        .then(() => {
          if (!mounted.current) return;
          setSaveError(null);
        })
        .catch(() => {
          // The language stays changed locally and on the account next time it
          // syncs; only the user is told, and only if we can say it.
          if (!mounted.current) return;
          setSaveError("language:save_failed");
        });
    },
    [persist],
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      direction: directionFor(locale),
      t,
      tc,
      setLocale,
      loading,
      saveError,
      reportSaveError: setSaveError,
      formatNumber: (v, options) => formatNumber(v, locale, options),
      formatDate: (v, options) => formatDate(v, locale, options),
      formatTime: (v, options) => formatTime(v, locale, options),
      formatDateTime: (v, options) => formatDateTime(v, locale, options),
      formatRelative: (v) => formatRelative(v, locale),
      formatPercent: (v, options) => formatPercent(v, locale, options),
      formatCurrency: (cents, currency) => formatCurrency(cents, currency, locale),
      formatCompact: (v) => formatCompact(v, locale),
      formatBytes: (v) => formatBytes(v, locale),
    }),
    [locale, t, tc, setLocale, loading, saveError],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}

/** Convenience hook for components that only need `t`. */
export function useTranslation() {
  const { t, tc, locale } = useI18n();
  return { t, tc, locale };
}

export { DEFAULT_LOCALE };
