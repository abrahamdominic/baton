"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { IconMenu, IconX } from "@/components/marketing/icons";
import { ThemeToggle } from "@/components/theme-toggle";

interface NavItem {
  href: string;
  label: string;
}

/**
 * The mobile navigation panel.
 *
 * It is a real dialog: it traps Tab focus, closes on Escape, restores focus to
 * the trigger, and locks background scroll while it is open. The trigger carries
 * `aria-expanded` and `aria-controls` so the state is announced.
 */
export function MobileMenu({
  items,
  accountHref,
  accountLabel,
  primaryHref,
  primaryLabel,
  openLabel,
  closeLabel,
  navLabel,
}: {
  items: NavItem[];
  accountHref: string;
  accountLabel: string;
  primaryHref: string;
  primaryLabel: string;
  openLabel: string;
  closeLabel: string;
  navLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;

    const panel = panelRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusables = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );

    focusables()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = focusables();
      if (nodes.length === 0) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, close]);

  return (
    <div className="md:hidden">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls="mobile-menu"
        aria-label={open ? closeLabel : openLabel}
        onClick={() => (open ? close() : setOpen(true))}
        className="flex h-9 w-9 items-center justify-center rounded-control border border-hairline-strong bg-ink-900 text-ink-200 transition-colors duration-fast hover:bg-ink-850 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
      >
        {open ? <IconX className="h-5 w-5" /> : <IconMenu className="h-5 w-5" />}
      </button>

      {open ? (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-ink-950/70 backdrop-blur-sm"
            onClick={close}
            aria-hidden="true"
          />
          <div
            ref={panelRef}
            id="mobile-menu"
            role="dialog"
            aria-modal="true"
            aria-label={navLabel}
            className="absolute inset-x-3 top-3 rounded-panel border border-hairline-strong bg-ink-900 p-4 shadow-lift"
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-semibold uppercase tracking-wide text-ink-400">
                {navLabel}
              </span>
              <ThemeToggle className="h-8" />
            </div>
            <nav className="mt-3 space-y-1" aria-label={navLabel}>
              {items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={close}
                  className="block rounded-control px-3 py-2 text-sm font-medium text-ink-200 transition-colors duration-fast hover:bg-ink-850 hover:text-ink-50"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="mt-3 flex flex-col gap-2 border-t border-hairline pt-3">
              <Link
                href={accountHref}
                onClick={close}
                className="inline-flex h-10 items-center justify-center rounded-control border border-hairline-strong bg-ink-900/70 text-sm font-medium text-ink-100 hover:bg-ink-850"
              >
                {accountLabel}
              </Link>
              <Link
                href={primaryHref}
                onClick={close}
                className="inline-flex h-10 items-center justify-center rounded-control border border-brand-400/40 bg-brand-500 text-sm font-medium text-on-brand hover:bg-brand-400"
              >
                {primaryLabel}
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
