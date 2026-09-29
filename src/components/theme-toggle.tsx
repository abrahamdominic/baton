"use client";

import { useEffect, useState } from "react";
import { IconMonitor, IconMoon, IconSun } from "@/components/icons";
import { useI18n } from "@/lib/i18n/provider";
import {
  DEFAULT_THEME_PREF,
  normalizeStoredTheme,
  resolveTheme,
  THEME_COLORS,
  THEME_KEY,
  type ResolvedTheme,
  type ThemePref,
} from "@/lib/theme";

function readStored(): ThemePref {
  try {
    return normalizeStoredTheme(localStorage.getItem(THEME_KEY));
  } catch {
    // Storage can be unavailable (private mode, blocked cookies). The theme still
    // applies for the session, so fall back to Baton's dark default.
    return DEFAULT_THEME_PREF;
  }
}

function applyTheme(pref: ThemePref) {
  const resolved = resolveTheme(
    pref,
    window.matchMedia("(prefers-color-scheme: light)").matches,
  );
  document.documentElement.setAttribute("data-theme", resolved);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLORS[resolved]);
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {
    /* storage unavailable — theme still applies for the session */
  }
  return resolved;
}

const OPTIONS: Array<{
  value: ThemePref;
  labelKey: "common:theme_dark" | "common:theme_light" | "common:theme_system";
  titleKey: "common:theme_dark_title" | "common:theme_light_title" | "common:theme_system_title";
  Icon: typeof IconMoon;
}> = [
  { value: "dark", labelKey: "common:theme_dark", titleKey: "common:theme_dark_title", Icon: IconMoon },
  { value: "light", labelKey: "common:theme_light", titleKey: "common:theme_light_title", Icon: IconSun },
  { value: "system", labelKey: "common:theme_system", titleKey: "common:theme_system_title", Icon: IconMonitor },
];

/**
 * Explicit Dark / Light / System control.
 *
 * The preference is a real choice rather than an implicit cycle: each option is
 * labelled, and the currently applied theme is always the highlighted one, so
 * "what does Baton look like right now?" is answerable at a glance.
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { t } = useI18n();
  const [pref, setPref] = useState<ThemePref | null>(null);
  const [resolved, setResolved] = useState<ResolvedTheme>("dark");

  useEffect(() => {
    const stored = readStored();
    setPref(stored);
    setResolved(applyTheme(stored));

    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onSystemChange = () => {
      if (readStored() === "system") setResolved(applyTheme("system"));
    };
    mq.addEventListener("change", onSystemChange);
    return () => mq.removeEventListener("change", onSystemChange);
  }, []);

  const choose = (next: ThemePref) => {
    setPref(next);
    setResolved(applyTheme(next));
  };

  // Until the effect has read storage, render a placeholder with the same box so
  // the header does not shift on hydration.
  if (pref === null) {
    return (
      <div
        aria-hidden="true"
        className={`inline-flex h-9 items-center rounded-lg border border-white/[0.1] bg-ink-900 p-0.5 ${className}`}
      />
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label={t("common:theme_label")}
      className={`inline-flex h-9 items-center gap-0.5 rounded-lg border border-white/[0.1] bg-ink-900 p-0.5 ${className}`}
    >
      {OPTIONS.map(({ value, labelKey, titleKey, Icon }) => {
        const active = pref === value;
        // The "system" option has to report what the OS actually resolved to,
        // otherwise the button is a dead end: it looks selected but gives no
        // indication of which of the other two it chose.
        const title =
          value === "system"
            ? t("common:theme_system_title", { resolved: t(`common:theme_${resolved}`) })
            : t(titleKey);
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            title={title}
            onClick={() => choose(value)}
            className={`inline-flex h-full items-center gap-1.5 rounded-[0.4rem] px-2 text-[11px] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-brand-400 ${
              active
                ? "bg-brand-500/20 text-on-brand ring-1 ring-brand-500/40"
                : "text-ink-400 hover:bg-white/[0.05] hover:text-white"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t(labelKey)}</span>
          </button>
        );
      })}
    </div>
  );
}
