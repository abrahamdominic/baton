import { STATE_META, type BatonState } from "@/lib/engine/types";
import { getTranslatorForRequest } from "@/lib/i18n/server-t";
import { stateLabel } from "@/lib/i18n/state-label";
import type { Translator } from "@/lib/i18n/translate";
import { Badge } from "@/components/ui";

/**
 * Server-rendered state badge and duration.
 *
 * Both need a translator, and `getTranslatorForRequest` is `server-only`, so
 * they live here rather than in `components/ui.tsx` — that module is also
 * imported from client components and must stay free of server-only imports.
 */
export async function StateBadge({ state }: { state: string }) {
  const { t } = await getTranslatorForRequest();
  const meta = STATE_META[state as BatonState];
  if (!meta) return <Badge tone="neutral">{stateLabel(state, t)}</Badge>;
  return <Badge tone={meta.tone}>{stateLabel(state, t)}</Badge>;
}

export async function Duration({ hours }: { hours: number }) {
  const { t } = await getTranslatorForRequest();
  return <span className="font-mono">{formatHours(hours, t)}</span>;
}

function formatHours(hours: number, t: Translator): string {
  if (hours < 1) return t("common:under_an_hour");
  if (hours < 24) return t("common:hours_short", { hours: Math.max(0, Math.round(hours)) });
  const days = Math.floor(hours / 24);
  const rem = Math.round(hours % 24);
  if (days === 1) return rem ? t("common:day_hours_short", { hours: rem }) : t("common:day_short", { days });
  return rem
    ? t("common:days_hours_short", { days, hours: rem })
    : t("common:days_short", { days });
}
