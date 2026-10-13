import { describe, it, expect } from "vitest";
import {
  buildPrepaintScript,
  DEFAULT_THEME_PREF,
  isThemePref,
  normalizeStoredTheme,
  resolveTheme,
  THEME_COLORS,
  THEME_KEY,
} from "./theme";

/**
 * Baton defaults to the visitor's system preference. A missing stored value
 * therefore resolves to `system`, which the pre-paint script resolves against
 * `prefers-color-scheme`; a concrete choice always wins over the OS.
 */
describe("normalizeStoredTheme", () => {
  it("defaults to system when nothing is stored (new user / first visit)", () => {
    expect(normalizeStoredTheme(null)).toBe("system");
    expect(normalizeStoredTheme(undefined)).toBe("system");
    expect(normalizeStoredTheme("")).toBe("system");
  });

  it("defaults to system for corrupt or legacy stored values", () => {
    expect(normalizeStoredTheme("midnight")).toBe("system");
    expect(normalizeStoredTheme("system-dark")).toBe("system");
    expect(normalizeStoredTheme(42)).toBe("system");
    expect(normalizeStoredTheme({})).toBe("system");
    expect(normalizeStoredTheme(true)).toBe("system");
  });

  it("preserves every legal stored preference, including system", () => {
    expect(normalizeStoredTheme("light")).toBe("light");
    expect(normalizeStoredTheme("dark")).toBe("dark");
    expect(normalizeStoredTheme("system")).toBe("system");
  });

  it("defaults to system, not a fixed theme", () => {
    expect(DEFAULT_THEME_PREF).toBe("system");
  });
});

describe("isThemePref", () => {
  it("accepts only the three supported values", () => {
    expect(isThemePref("dark")).toBe(true);
    expect(isThemePref("light")).toBe(true);
    expect(isThemePref("system")).toBe(true);
    expect(isThemePref("auto")).toBe(false);
    expect(isThemePref("Dark")).toBe(false);
    expect(isThemePref(null)).toBe(false);
  });
});

describe("resolveTheme", () => {
  it("honours an explicit dark choice even when the OS prefers light", () => {
    expect(resolveTheme("dark", true)).toBe("dark");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("honours an explicit light choice even when the OS prefers dark", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("light", false)).toBe("light");
  });

  it("follows the OS only when the user asked for system", () => {
    expect(resolveTheme("system", true)).toBe("light");
    expect(resolveTheme("system", false)).toBe("dark");
  });
});

describe("THEME_COLORS", () => {
  it("has a browser-chrome color for each concrete theme", () => {
    expect(THEME_COLORS.dark).toMatch(/^#[0-9A-F]{6}$/i);
    expect(THEME_COLORS.light).toMatch(/^#[0-9A-F]{6}$/i);
    expect(THEME_COLORS.dark).not.toBe(THEME_COLORS.light);
  });
});

describe("buildPrepaintScript", () => {
  const script = buildPrepaintScript();

  it("inlines the shared storage key and system default", () => {
    expect(script).toContain(JSON.stringify(THEME_KEY));
    expect(script).toContain(JSON.stringify(DEFAULT_THEME_PREF));
  });

  it("falls back to the system preference when storage is empty", () => {
    // `var t=d` with d="system" is what makes a first visit follow the OS.
    expect(script).toContain("var t=d");
    expect(script).toContain('==="system"');
  });

  it("applies the resolved theme to the document before paint", () => {
    expect(script).toContain('document.documentElement.setAttribute("data-theme",r)');
  });

  it("keeps the browser chrome color in step with the theme", () => {
    expect(script).toContain('meta[name="theme-color"]');
  });

  it("re-resolves only while the stored preference is system", () => {
    expect(script).toContain('==="system")apply("system")');
  });

  it("never throws when storage or matchMedia are unavailable", () => {
    // Every storage and matchMedia access is inside a try/catch.
    expect((script.match(/try\{/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
