"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

/**
 * The single modal shell for every overlay in Baton (confirmation dialogs,
 * destructive-action prompts, and composer dialogs). Renders a fixed overlay +
 * centered card, closes on backdrop click / Escape, traps focus, and restores
 * focus to the trigger. There is deliberately no second, one-off dialog
 * implementation: any new surface composes `Dialog` (or `ConfirmDialog`) so
 * focus handling, spacing, and tokens stay consistent.
 */
export function Dialog({
  open,
  onClose,
  tone = "brand",
  labelledBy,
  label,
  size = "md",
  bare = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  tone?: "brand" | "danger" | "warn";
  labelledBy?: string;
  /** Accessible name when no `labelledBy` element id is available. */
  label?: string;
  size?: "md" | "lg";
  /**
   * When true the card has no padding and no clipping, so the children can lay
   * out their own header/body/footer chrome (composer dialogs). When false the
   * card is padded for a short body of text and controls.
   */
  bare?: boolean;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const initial = dialog.querySelector<HTMLElement>("[data-autofocus]");
      const first = dialog.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      (initial ?? first ?? dialog).focus();
    });
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) {
        e.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey);
      previouslyFocused.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  const toneRing =
    tone === "danger" ? "border-danger-500/30" : tone === "warn" ? "border-warn-500/30" : "border-brand-500/30";
  const width = size === "lg" ? "max-w-lg" : "max-w-md";
  const surface = bare ? "overflow-hidden rounded-2xl" : "rounded-xl p-5";

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
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : label}
        ref={dialogRef}
        tabIndex={-1}
        className={`relative w-full ${width} border border-white/[0.1] ${toneRing} ${surface} bg-ink-900 shadow-2xl`}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Confirmation-style dialog built on the shared `Dialog` shell, for
 * admin actions, plan cancellations, and destructive confirmations.
 */
export function ConfirmDialog({
  open,
  onClose,
  tone = "danger",
  labelledBy,
  children,
}: {
  open: boolean;
  onClose: () => void;
  tone?: "brand" | "danger" | "warn";
  labelledBy?: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onClose={onClose} tone={tone} labelledBy={labelledBy}>
      {children}
    </Dialog>
  );
}
