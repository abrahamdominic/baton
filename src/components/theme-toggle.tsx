"use client";

import { useEffect, useState } from "react";
import { IconMonitor, IconMoon, IconSun } from "@/components/icons";

export type ThemePref = "light" | "dark" | "system";

const THEME_KEY = "baton-theme";

const ORDER: ThemePref[] = ["light", "dark", "system"];

function readStored(): ThemePref {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
  } catch {
    return "system";
  }
}

function applyTheme(pref: ThemePref) {
  const resolved =
    pref === "system"
      ? window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark"
      : pref;
  document.documentElement.setAttribute("data-theme", resolved);
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {
    /* storage unavailable (private mode) — theme still applies for the session */
  }
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [pref, setPref] = useState<ThemePref | null>(null);

  useEffect(() => {
    setPref(readStored());
    applyTheme(readStored());
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onSystemChange = () => {
      if (readStored() === "system") applyTheme("system");
    };
    mq.addEventListener("change", onSystemChange);
    return () => mq.removeEventListener("change", onSystemChange);
  }, []);

  const cycle = () => {
    const next = ORDER[(ORDER.indexOf(pref ?? "system") + 1) % ORDER.length];
    setPref(next);
    applyTheme(next);
  };

  const label =
    pref === "light" ? "Switch to dark mode" : pref === "dark" ? "Use system theme" : "Switch to light mode";
  const Icon = pref === "light" ? IconSun : pref === "dark" ? IconMoon : IconMonitor;

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`Theme: ${label}`}
      title={label}
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/[0.1] bg-ink-900 text-ink-300 transition-colors hover:bg-ink-850 hover:text-white focus-visible:ring-2 focus-visible:ring-brand-400 ${className}`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}