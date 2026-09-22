"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BatonLogo } from "@/components/logo";
import {
  IconActivity,
  IconBranch,
  IconExternalLink,
  IconGauge,
  IconLogOut,
  IconMenu,
  IconSettings,
  IconX,
} from "@/components/icons";

interface NavItem {
  href: string;
  label: string;
  icon: typeof IconGauge;
  /** Exact match for the root dashboard page; prefix match otherwise. */
  exact?: boolean;
}

const WORKSPACE_NAV: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: IconGauge, exact: true },
  { href: "/dashboard/repos", label: "Repositories", icon: IconBranch },
  { href: "/dashboard/activity", label: "Activity", icon: IconActivity },
];

const ACCOUNT_NAV: NavItem[] = [
  { href: "/dashboard/settings", label: "Settings", icon: IconSettings },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href || pathname === `${item.href}/`;
  return pathname.startsWith(item.href);
}

interface ShellUser {
  login: string;
  name: string | null;
  avatarUrl: string | null;
  githubUrl: string;
}

function NavLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = isActive(pathname, item);
  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-semibold transition-colors ${
          active
            ? "bg-white/[0.06] text-white"
            : "text-ink-400 hover:bg-white/[0.04] hover:text-white"
        }`}
      >
        <item.icon className="h-4 w-4 shrink-0" />
        <span className="truncate">{item.label}</span>
      </Link>
    </li>
  );
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-2" aria-label="Dashboard">
      <div>
        <p className="px-2.5 pb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
          Workspace
        </p>
        <ul className="space-y-1">
          {WORKSPACE_NAV.map((item) => (
            <NavLink key={item.href} item={item} onNavigate={onNavigate} />
          ))}
        </ul>
      </div>
      <div>
        <p className="px-2.5 pb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
          Account
        </p>
        <ul className="space-y-1">
          {ACCOUNT_NAV.map((item) => (
            <NavLink key={item.href} item={item} onNavigate={onNavigate} />
          ))}
        </ul>
      </div>
    </nav>
  );
}

function AccountFooter({ user, onNavigate }: { user: ShellUser; onNavigate?: () => void }) {
  return (
    <div className="border-t border-white/[0.07] p-3">
      <div className="flex items-center gap-3 rounded-lg px-2 py-2">
        {user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.avatarUrl}
            alt={user.login}
            width={28}
            height={28}
            className="h-7 w-7 rounded-full ring-1 ring-white/20"
          />
        ) : (
          <span className="flex h-7 w-7 items-center justify-center rounded-full border border-white/[0.1] bg-ink-800 font-mono text-xs font-bold text-ink-200">
            {(user.name ?? user.login).slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-white">{user.name ?? user.login}</p>
          <p className="truncate font-mono text-[11px] text-ink-400">@{user.login}</p>
        </div>
        <a
          href={user.githubUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`View ${user.login} on GitHub`}
          className="rounded-md p-1.5 text-ink-400 transition-colors hover:bg-white/[0.06] hover:text-white"
        >
          <IconExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
      <a
        href="/auth/logout"
        onClick={onNavigate}
        className="mt-1 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-semibold text-ink-400 transition-colors hover:bg-danger-500/10 hover:text-danger-300"
      >
        <IconLogOut className="h-4 w-4 shrink-0" />
        Sign out
      </a>
    </div>
  );
}

function SidebarBody({ user, onNavigate }: { user: ShellUser; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center border-b border-white/[0.07] px-4">
        <BatonLogo href="/dashboard" size="sm" showBadge={false} />
      </div>
      <SidebarNav onNavigate={onNavigate} />
      <AccountFooter user={user} onNavigate={onNavigate} />
    </div>
  );
}

export function AppShell({ user, children }: { user: ShellUser; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  // Close on Escape and lock body scroll while the mobile sheet is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <div className="min-h-screen bg-ink-950 text-ink-100">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-white/[0.08] bg-ink-950 lg:block">
        <SidebarBody user={user} />
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-white/[0.07] bg-ink-950/90 px-4 backdrop-blur-md lg:hidden">
        <BatonLogo href="/dashboard" size="sm" showBadge={false} />
        <div className="flex items-center gap-2">
          <a
            href="/docs"
            className="hidden rounded-md px-2 py-1 text-xs font-medium text-ink-400 transition-colors hover:text-white sm:block"
          >
            Docs
          </a>
          {user.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.avatarUrl}
              alt={user.login}
              width={26}
              height={26}
              className="h-[26px] w-[26px] rounded-full ring-1 ring-white/20"
            />
          ) : null}
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open navigation menu"
            aria-expanded={open}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.1] bg-ink-900 text-ink-200 transition-colors hover:bg-ink-850 hover:text-white"
          >
            <IconMenu className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* Mobile navigation sheet */}
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Dashboard navigation"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col border-r border-white/[0.1] bg-ink-950 shadow-2xl"
          >
            <div className="flex items-center justify-end border-b border-white/[0.07] py-2 pr-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation menu"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.1] bg-ink-900 text-ink-200 transition-colors hover:bg-ink-850 hover:text-white"
              >
                <IconX className="h-4 w-4" />
              </button>
            </div>
            <SidebarBody user={user} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      ) : null}

      {/* Main content */}
      <div className="lg:pl-64">
        <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}