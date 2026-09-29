/**
 * Test-only render helpers for components that read translations.
 *
 * A component that calls `useI18n` needs an `<I18nProvider>` above it, and
 * `<I18nProvider>` needs its bundles passed in rather than fetched. This
 * renders the real English resources, so a test asserts against the same copy
 * a user sees instead of a hand-written fixture that can drift.
 *
 * Test-only by intent: it lives under `src/` but matches no test glob and is
 * imported by nothing in the app, so it is never bundled.
 */

import React from "react";
import { renderToString } from "react-dom/server";
import { I18nProvider } from "@/lib/i18n/provider";
import { englishFlat } from "@/lib/i18n/bundles";
import { DEFAULT_LOCALE } from "@/lib/i18n/config";
import { render } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";

/** The real English resource tree, flattened the way the provider expects. */
const EN_BUNDLES = { en: englishFlat() };

/** Wraps `ui` in a provider backed by the shipped English resources. */
export function withI18n(ui: React.ReactNode): React.ReactElement {
  return (
    <I18nProvider initialLocale={DEFAULT_LOCALE} bundles={EN_BUNDLES} persist={() => {}}>
      {ui}
    </I18nProvider>
  );
}

/** `render` with the provider already in place. */
export function renderWithI18n(ui: React.ReactNode): RenderResult {
  return render(withI18n(ui));
}

/** `renderToString` with the provider already in place. */
export function renderToStringWithI18n(ui: React.ReactNode): string {
  return renderToString(withI18n(ui));
}
