/**
 * Baton's single theme system.
 *
 * Both the pre-paint script in the root layout and the client `<ThemeToggle>`
 * resolve the preference through this module so there is exactly one place that
 * owns the storage key, the legal values, the default, and the
 * `system -> concrete` resolution rule.
 *
 * Dark is the default for a new visitor: the stored value is absent on a first
 * visit, and an OS that prefers light must NOT override Baton's default. A user
 * who explicitly picks "System" still gets live OS following.
 */

export const THEME_KEY = "baton-theme";

export type ThemePref = "light" | "dark" | "system";

/** The resolved, concrete theme that is actually written to `data-theme`. */
export type ResolvedTheme = Exclude<ThemePref, "system">;

/** Baton's default experience for someone who has never chosen a theme. */
export const DEFAULT_THEME_PREF: ThemePref = "dark";

/** Order used by the toggle when cycling through the three options. */
export const THEME_CYCLE: ThemePref[] = ["dark", "light", "system"];

export function isThemePref(value: unknown): value is ThemePref {
  return value === "light" || value === "dark" || value === "system";
}

/**
 * Normalize a stored value. Anything missing, corrupt, or from an older build
 * falls back to Baton's dark default rather than to `system`, so a stale
 * `localStorage` entry can never hand a new user a light first paint.
 */
export function normalizeStoredTheme(value: unknown): ThemePref {
  return isThemePref(value) ? value : DEFAULT_THEME_PREF;
}

/**
 * Turn a preference into the theme to paint. `system` follows the OS; every other
 * value is already concrete.
 */
export function resolveTheme(pref: ThemePref, prefersLight: boolean): ResolvedTheme {
  if (pref === "system") return prefersLight ? "light" : "dark";
  return pref;
}

/** Browser-chrome colors, keyed by the resolved theme. */
export const THEME_COLORS: Record<ResolvedTheme, string> = {
  dark: "#08090C",
  light: "#F4F6FA",
};

/**
 * The pre-paint snippet. It must run before first paint to avoid a flash of the
 * wrong theme, so it is inlined and kept dependency-free.
 *
 * Reuses `THEME_KEY`/`DEFAULT_THEME_PREF` from this module at build time so the
 * server-rendered script and the client toggle can never drift apart.
 */
export function buildPrepaintScript(): string {
  return `(function(){var k=${JSON.stringify(THEME_KEY)};var d=${JSON.stringify(
    DEFAULT_THEME_PREF,
  )};var c=${JSON.stringify(THEME_COLORS)};var t=d;try{var s=localStorage.getItem(k);if(s==="light"||s==="dark"||s==="system")t=s}catch(e){}var apply=function(p){var r=p==="system"?((window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches)?"light":"dark"):p;document.documentElement.setAttribute("data-theme",r);var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",c[r])};apply(t);try{window.matchMedia("(prefers-color-scheme: light)").addEventListener("change",function(){try{if((localStorage.getItem(k)||d)==="system")apply("system")}catch(e){}})}catch(e){}})();`;
}
