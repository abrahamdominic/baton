"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";

/**
 * Shared modal shell for confirmation-style dialogs (admin actions, plan
 * cancellations, checkout cancellations). Renders a fixed overlay + centered
 * card, closes on backdrop click / Escape, and is keyboard-focus safe.
 */
export function ConfirmDialog({
  open,
  onClose,
  tone = "danger",
  children,
}: {
  open: boolean;
  onClose: () => void;
  tone?: "brand" | "danger" | "warn";
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const toneRing =
    tone === "danger" ? "border-danger-500/30" : tone === "warn" ? "border-warn-500/30" : "border-brand-500/30";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        className={`relative w-full max-w-md rounded-xl border border-white/[0.1] ${toneRing} bg-ink-900 p-5 shadow-2xl`}
      >
        {children}
      </div>
    </div>
  );
}