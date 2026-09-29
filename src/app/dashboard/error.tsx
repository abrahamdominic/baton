"use client";

import { useEffect } from "react";
import { IconAlertCircle, IconRefresh } from "@/components/icons";
import { useI18n } from "@/lib/i18n/provider";

/**
 * Error boundary scoped to a single dashboard page.
 *
 * The root `src/app/error.tsx` renders a full-height screen, which is right for a
 * failure that took down the whole app. Here that would be wrong: a single failed
 * query would replace the `AppShell` from `layout.tsx`, so the user loses the
 * sidebar, the workspace switcher, and every nav link - and the only way back is
 * the dashboard link on the error screen itself. A boundary at this level keeps
 * the shell and loses just the page that failed.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useI18n();

  useEffect(() => {
    console.error("[baton] dashboard page error", error.digest ?? "", error);
  }, [error]);

  return (
    <div className="rounded-xl border border-white/[0.07] bg-ink-900/50 px-6 py-14 text-center">
      <IconAlertCircle className="mx-auto h-10 w-10 text-signal-400" />

      <h2 className="mt-5 text-lg font-bold text-ink-50">
        {t("errors:server_error")}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-ink-300">
        {t("errors:generic")}
      </p>

      {error.digest ? (
        <p className="mt-4 font-mono text-[10px] text-ink-500">
          {t("errors:details")}: {error.digest}
        </p>
      ) : null}

      <button type="button" onClick={reset} className="btn-primary mt-7">
        <IconRefresh className="h-4 w-4" />
        {t("errors:try_again")}
      </button>
    </div>
  );
}
