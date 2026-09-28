import { PageHeader } from "@/components/ui";
import { LanguagePicker } from "@/components/language-picker";
import { LANGUAGES } from "@/lib/i18n/languages";
import { getTranslator } from "@/lib/i18n/server-t";
import { resolveRequestLocale } from "@/lib/i18n/resolve";

export const dynamic = "force-dynamic";

/**
 * Settings → Language (lan.md §4).
 *
 * The page itself renders in the user's language on the server, and the picker
 * switches the rest of the app client-side without a navigation. Nothing here
 * needs to be a client component: only the interactive list is.
 */
export default async function LanguageSettingsPage() {
  const { locale } = await resolveRequestLocale();
  const t = await getTranslator(locale);

  return (
    <>
      <PageHeader
        eyebrow={t("settings:title")}
        title={t("language:title")}
        description={t("language:description")}
      />

      <div className="mt-6">
        <LanguagePicker languages={LANGUAGES} />
      </div>
    </>
  );
}
