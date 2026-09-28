"use client";

import { useState, useTransition } from "react";
import { toggleSaveContextAction } from "./actions";
import { IconBookmark } from "@/components/icons";

export function SaveContextButton({
  owner,
  repo,
  prNumber,
  title,
  isPreserved,
  existingContextId,
}: {
  owner: string;
  repo: string;
  prNumber: number;
  title: string;
  isPreserved: boolean;
  existingContextId?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleToggle = () => {
    setError(null);
    startTransition(async () => {
      const result = await toggleSaveContextAction({
        owner,
        repo,
        prNumber,
        title,
        existingContextId,
      });
      if (!result.ok) setError(result.error);
    });
  };

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={handleToggle}
        disabled={isPending}
        className={`btn btn-sm inline-flex items-center gap-1.5 transition-all ${
          isPreserved
            ? "border-brand-500/40 bg-brand-500/20 text-brand-300 hover:bg-brand-500/30"
            : "btn-ghost"
        }`}
        title={
          isPreserved
            ? "Preserved work context (click to remove)"
            : "Save as active work context to resume later"
        }
      >
        <IconBookmark className={`h-3.5 w-3.5 ${isPreserved ? "fill-brand-400 text-brand-400" : ""}`} />
        <span>{isPending ? "Updating..." : isPreserved ? "Context Preserved" : "Preserve Context"}</span>
      </button>
      {error && (
        <span role="alert" className="text-[11px] text-signal-300">
          {error}
        </span>
      )}
    </span>
  );
}
