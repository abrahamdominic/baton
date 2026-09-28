/**
 * GENERATED FILE - DO NOT EDIT.
 *
 * Regenerate with:  npm run i18n:generate
 * Source of truth:  the locales directory tree.
 *
 * import() requires a literal specifier for the bundler to code-split, so
 * each language gets a generated loader. That keeps a client in English from
 * downloading any other language, while adding a language stays a matter of
 * creating a directory and re-running the generator.
 */

import type { TranslationTree } from "./translate";

export type LocaleLoaders = Record<string, () => Promise<TranslationTree>>;

import en_admin from "@/locales/en/admin.json";
import en_auth from "@/locales/en/auth.json";
import en_billing from "@/locales/en/billing.json";
import en_common from "@/locales/en/common.json";
import en_dashboard from "@/locales/en/dashboard.json";
import en_errors from "@/locales/en/errors.json";
import en_language from "@/locales/en/language.json";
import en_legal from "@/locales/en/legal.json";
import en_messaging from "@/locales/en/messaging.json";
import en_navigation from "@/locales/en/navigation.json";
import en_notifications from "@/locales/en/notifications.json";
import en_onboarding from "@/locales/en/onboarding.json";
import en_organizations from "@/locales/en/organizations.json";
import en_pulls from "@/locales/en/pulls.json";
import en_repos from "@/locales/en/repos.json";
import en_settings from "@/locales/en/settings.json";
import en_teams from "@/locales/en/teams.json";
import en_theme from "@/locales/en/theme.json";

/** The guaranteed-complete locale, used as the fallback layer everywhere. */
export const EN_BUNDLE: TranslationTree = {
  admin: en_admin,
  auth: en_auth,
  billing: en_billing,
  common: en_common,
  dashboard: en_dashboard,
  errors: en_errors,
  language: en_language,
  legal: en_legal,
  messaging: en_messaging,
  navigation: en_navigation,
  notifications: en_notifications,
  onboarding: en_onboarding,
  organizations: en_organizations,
  pulls: en_pulls,
  repos: en_repos,
  settings: en_settings,
  teams: en_teams,
  theme: en_theme,
};

/** Namespace names, derived from the resources rather than repeated by hand.
 *  Generated so a new namespace never needs a hand edit here. */
export const NAMESPACES: readonly string[] = ["admin","auth","billing","common","dashboard","errors","language","legal","messaging","navigation","notifications","onboarding","organizations","pulls","repos","settings","teams","theme"];

/** Lazy loaders for every language that has resources. */
export const LOCALE_LOADERS: LocaleLoaders = {
  "es": () =>
    Promise.all([
      import("@/locales/es/admin.json"),
      import("@/locales/es/auth.json"),
      import("@/locales/es/billing.json"),
      import("@/locales/es/common.json"),
      import("@/locales/es/dashboard.json"),
      import("@/locales/es/errors.json"),
      import("@/locales/es/language.json"),
      import("@/locales/es/legal.json"),
      import("@/locales/es/messaging.json"),
      import("@/locales/es/navigation.json"),
      import("@/locales/es/notifications.json"),
      import("@/locales/es/onboarding.json"),
      import("@/locales/es/organizations.json"),
      import("@/locales/es/pulls.json"),
      import("@/locales/es/repos.json"),
      import("@/locales/es/settings.json"),
      import("@/locales/es/teams.json"),
      import("@/locales/es/theme.json"),
    ]).then((mods) => ({
      admin: mods[0]!.default,
      auth: mods[1]!.default,
      billing: mods[2]!.default,
      common: mods[3]!.default,
      dashboard: mods[4]!.default,
      errors: mods[5]!.default,
      language: mods[6]!.default,
      legal: mods[7]!.default,
      messaging: mods[8]!.default,
      navigation: mods[9]!.default,
      notifications: mods[10]!.default,
      onboarding: mods[11]!.default,
      organizations: mods[12]!.default,
      pulls: mods[13]!.default,
      repos: mods[14]!.default,
      settings: mods[15]!.default,
      teams: mods[16]!.default,
      theme: mods[17]!.default,
    })) as Promise<TranslationTree>,
};

/** Every language that has a locales directory. */
export const RESOURCE_LANGUAGES: readonly string[] = ["en","es"];
