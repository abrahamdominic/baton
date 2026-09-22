"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconRefresh, IconCheck, IconAlertCircle } from "@/components/icons";
import { syncUserRepositories } from "@/app/dashboard/actions";

export function RepoSyncButton() {
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
        title="Query GitHub App installations and sync all accessible repositories"
      >
        <IconRefresh className={`h-3.5 w-3.5 ${isPending ? "animate-spin text-brand-400" : ""}`} />
        <span>{isPending ? "Syncing..." : "Sync with GitHub"}</span>
      </button>

      {status === "success" && (
        <span className="flex items-center gap-1 text-xs text-signal-400 animate-in fade-in duration-200">
          <IconCheck className="h-3.5 w-3.5" />
          <span>Synced {syncedCount ?? 0} repos</span>
        </span>
      )}

      {status === "error" && (
        <span className="flex items-center gap-1 text-xs text-danger-400 animate-in fade-in duration-200">
          <IconAlertCircle className="h-3.5 w-3.5" />
          <span>Sync failed</span>
        </span>
      )}
    </div>
  );
}
