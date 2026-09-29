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

import en_activity from "@/locales/en/activity.json";
import en_admin from "@/locales/en/admin.json";
import en_auth from "@/locales/en/auth.json";
import en_billing from "@/locales/en/billing.json";
import en_common from "@/locales/en/common.json";
import en_dashboard from "@/locales/en/dashboard.json";
import en_docs from "@/locales/en/docs.json";
import en_errors from "@/locales/en/errors.json";
import en_faq from "@/locales/en/faq.json";
import en_intelligence from "@/locales/en/intelligence.json";
import en_language from "@/locales/en/language.json";
import en_legal from "@/locales/en/legal.json";
import en_marketing from "@/locales/en/marketing.json";
import en_messaging from "@/locales/en/messaging.json";
import en_navigation from "@/locales/en/navigation.json";
import en_notifications from "@/locales/en/notifications.json";
import en_onboarding from "@/locales/en/onboarding.json";
import en_organizations from "@/locales/en/organizations.json";
import en_pulls from "@/locales/en/pulls.json";
import en_repos from "@/locales/en/repos.json";
import en_security from "@/locales/en/security.json";
import en_settings from "@/locales/en/settings.json";
import en_state from "@/locales/en/state.json";
import en_teams from "@/locales/en/teams.json";
import en_theme from "@/locales/en/theme.json";
import en_workspace from "@/locales/en/workspace.json";

/** The guaranteed-complete locale, used as the fallback layer everywhere. */
export const EN_BUNDLE: TranslationTree = {
  activity: en_activity,
  admin: en_admin,
  auth: en_auth,
  billing: en_billing,
  common: en_common,
  dashboard: en_dashboard,
  docs: en_docs,
  errors: en_errors,
  faq: en_faq,
  intelligence: en_intelligence,
  language: en_language,
  legal: en_legal,
  marketing: en_marketing,
  messaging: en_messaging,
  navigation: en_navigation,
  notifications: en_notifications,
  onboarding: en_onboarding,
  organizations: en_organizations,
  pulls: en_pulls,
  repos: en_repos,
  security: en_security,
  settings: en_settings,
  state: en_state,
  teams: en_teams,
  theme: en_theme,
  workspace: en_workspace,
};

/** Namespace names, derived from the resources rather than repeated by hand.
 *  Generated so a new namespace never needs a hand edit here. */
export const NAMESPACES: readonly string[] = ["activity","admin","auth","billing","common","dashboard","docs","errors","faq","intelligence","language","legal","marketing","messaging","navigation","notifications","onboarding","organizations","pulls","repos","security","settings","state","teams","theme","workspace"];

/** Lazy loaders for every language that has resources. */
export const LOCALE_LOADERS: LocaleLoaders = {
  "es": () =>
    Promise.all([
      import("@/locales/es/activity.json"),
      import("@/locales/es/admin.json"),
      import("@/locales/es/auth.json"),
      import("@/locales/es/billing.json"),
      import("@/locales/es/common.json"),
      import("@/locales/es/dashboard.json"),
      import("@/locales/es/docs.json"),
      import("@/locales/es/errors.json"),
      import("@/locales/es/faq.json"),
      import("@/locales/es/intelligence.json"),
      import("@/locales/es/language.json"),
      import("@/locales/es/legal.json"),
      import("@/locales/es/marketing.json"),
      import("@/locales/es/messaging.json"),
      import("@/locales/es/navigation.json"),
      import("@/locales/es/notifications.json"),
      import("@/locales/es/onboarding.json"),
      import("@/locales/es/organizations.json"),
      import("@/locales/es/pulls.json"),
      import("@/locales/es/repos.json"),
      import("@/locales/es/security.json"),
      import("@/locales/es/settings.json"),
      import("@/locales/es/state.json"),
      import("@/locales/es/teams.json"),
      import("@/locales/es/theme.json"),
      import("@/locales/es/workspace.json"),
    ]).then((mods) => ({
      activity: mods[0]!.default,
      admin: mods[1]!.default,
      auth: mods[2]!.default,
      billing: mods[3]!.default,
      common: mods[4]!.default,
      dashboard: mods[5]!.default,
      docs: mods[6]!.default,
      errors: mods[7]!.default,
      faq: mods[8]!.default,
      intelligence: mods[9]!.default,
      language: mods[10]!.default,
      legal: mods[11]!.default,
      marketing: mods[12]!.default,
      messaging: mods[13]!.default,
      navigation: mods[14]!.default,
      notifications: mods[15]!.default,
      onboarding: mods[16]!.default,
      organizations: mods[17]!.default,
      pulls: mods[18]!.default,
      repos: mods[19]!.default,
      security: mods[20]!.default,
      settings: mods[21]!.default,
      state: mods[22]!.default,
      teams: mods[23]!.default,
      theme: mods[24]!.default,
      workspace: mods[25]!.default,
    })) as Promise<TranslationTree>,
};

/** Every language that has a locales directory. */
export const RESOURCE_LANGUAGES: readonly string[] = ["en","es"];
