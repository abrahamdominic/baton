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
 * The reported bug: a visitor whose OS prefers light saw a light first paint on
 * a first visit, because the pre-paint script treated "no stored value" as
 * `system`. Baton is a dark-first product, so a missing value must resolve to
 * dark regardless of the OS.
 */
describe("normalizeStoredTheme", () => {
  it("defaults to dark when nothing is stored (new user / first visit)", () => {
    expect(normalizeStoredTheme(null)).toBe("dark");
    expect(normalizeStoredTheme(undefined)).toBe("dark");
    expect(normalizeStoredTheme("")).toBe("dark");
  });

  it("defaults to dark for corrupt or legacy stored values", () => {
    expect(normalizeStoredTheme("midnight")).toBe("dark");
    expect(normalizeStoredTheme("system-dark")).toBe("dark");
    expect(normalizeStoredTheme(42)).toBe("dark");
    expect(normalizeStoredTheme({})).toBe("dark");
    expect(normalizeStoredTheme(true)).toBe("dark");
  });

  it("preserves every legal stored preference, including system", () => {
    expect(normalizeStoredTheme("light")).toBe("light");
    expect(normalizeStoredTheme("dark")).toBe("dark");
    expect(normalizeStoredTheme("system")).toBe("system");
  });

  it("defaults to dark, not system", () => {
    expect(DEFAULT_THEME_PREF).toBe("dark");
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

  it("inlines the shared storage key and dark default", () => {
    expect(script).toContain(JSON.stringify(THEME_KEY));
    expect(script).toContain(JSON.stringify(DEFAULT_THEME_PREF));
  });

  it("does not fall back to system when storage is empty", () => {
    // `var t=d` with d="dark" is what makes a first visit dark.
    expect(script).toContain("var t=d");
    expect(script).not.toContain('||"system"');
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
