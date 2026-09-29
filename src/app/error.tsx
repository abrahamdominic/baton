"use client";

import { useEffect } from "react";
import { IconAlertCircle, IconRefresh } from "@/components/icons";
import { useI18n } from "@/lib/i18n/provider";

/**
 * Route-level error boundary.
 *
 * A throw inside a server component or a data fetch reaches the user as
 * Next.js's built-in error page unless this file exists. That default is
 * unstyled and, more importantly, tells the user nothing they can act on. This
 * boundary keeps the app's own chrome, states the failure in the user's
 * language, and offers a retry that re-runs the failed render rather than
 * forcing a full navigation.
 *
 * `reset()` re-renders the segment. It is the right primary action for a
 * transient fetch failure, so it is offered before the heavier "go home" one.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useI18n();

  useEffect(() => {
    // Client-side logging is the only signal available without an error
    // reporter. The digest is the key that ties this line to the server log
    // entry, so it is logged even though it is useless to the user directly.
    console.error("[baton] route error", error.digest ?? "", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-ink-950 px-6 py-24 text-center text-ink-100">
      <IconAlertCircle className="h-12 w-12 text-signal-400" />

      <h1 className="mt-8 text-2xl font-extrabold tracking-tight text-ink-50 sm:text-3xl">
        {t("errors:server_error")}
      </h1>
      <p className="mt-4 max-w-md text-sm leading-relaxed text-ink-300">
        {t("errors:generic")}
      </p>

      {error.digest ? (
        <p className="mt-6 font-mono text-[11px] text-ink-500">
          {t("errors:details")}: {error.digest}
        </p>
      ) : null}

      <div className="mt-10 flex flex-col gap-3 sm:flex-row">
        <button type="button" onClick={reset} className="btn-primary">
          <IconRefresh className="h-4 w-4" />
          {t("errors:try_again")}
        </button>
        <a href="/dashboard" className="btn-secondary">
          {t("navigation:dashboard")}
        </a>
      </div>
    </div>
  );
}
