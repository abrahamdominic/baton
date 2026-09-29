"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconRefresh, IconCheck, IconAlertCircle } from "@/components/icons";
import { syncUserRepositories } from "@/app/dashboard/actions";
import { useI18n } from "@/lib/i18n/provider";

export function RepoSyncButton() {
  const { t } = useI18n();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [syncedCount, setSyncedCount] = useState<number | null>(null);

  const handleSync = () => {
    startTransition(async () => {
      try {
        setStatus("idle");
        const res = await syncUserRepositories();
        setSyncedCount(res.count);
        setStatus("success");
        router.refresh();
        setTimeout(() => {
          setStatus("idle");
        }, 4000);
      } catch (err) {
        console.error("Failed to sync repositories:", err);
        setStatus("error");
        setTimeout(() => {
          setStatus("idle");
        }, 4000);
      }
    });
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleSync}
        disabled={isPending}
        className="btn btn-secondary btn-sm"
        title={t("workspace:sync_github_aria")}
      >
        <IconRefresh className={`h-3.5 w-3.5 ${isPending ? "animate-spin text-brand-400" : ""}`} />
        <span>{isPending ? t("workspace:syncing") : t("workspace:sync_with_github")}</span>
      </button>

      {status === "success" && (
        <span className="flex items-center gap-1 text-xs text-signal-400 animate-in fade-in duration-200">
          <IconCheck className="h-3.5 w-3.5" />
          <span>{t("workspace:synced_repos", { count: syncedCount ?? 0 })}</span>
        </span>
      )}

      {status === "error" && (
        <span className="flex items-center gap-1 text-xs text-danger-400 animate-in fade-in duration-200">
          <IconAlertCircle className="h-3.5 w-3.5" />
          <span>{t("workspace:sync_failed")}</span>
        </span>
      )}
    </div>
  );
}
