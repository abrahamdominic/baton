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
  IconShield,
  IconX,
  IconChevronRight,
  IconTerminal,
  IconGitHub,
} from "@/components/icons";

interface NavItem {
  href: string;
  label: string;
  icon: typeof IconGauge;
  badge?: string;
  exact?: boolean;
}

const WORKSPACE_NAV: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: IconGauge, exact: true },
  { href: "/dashboard/repos", label: "Repositories", icon: IconBranch },
  { href: "/dashboard/activity", label: "Activity Ledger", icon: IconActivity },
];

const ACCOUNT_NAV: NavItem[] = [
  { href: "/dashboard/billing", label: "Billing & Plans", icon: IconShield },
  { href: "/dashboard/settings", label: "Account & Integrations", icon: IconSettings },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href || pathname === `${item.href}/`;
  return pathname.startsWith(item.href);
}

export interface ShellUser {
  login: string;
  name: string | null;
  avatarUrl: string | null;
  githubUrl: string;
  role?: string;
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
        className={`group relative flex items-center justify-between rounded-lg px-3 py-2.5 text-xs font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-1 focus-visible:ring-offset-ink-950 ${
          active
            ? "bg-brand-500/10 text-white font-semibold shadow-sm"
            : "text-ink-400 hover:bg-white/[0.04] hover:text-ink-200"
        }`}
      >
        <div className="flex items-center gap-2.5 truncate">
          <item.icon
            className={`h-4 w-4 shrink-0 transition-colors ${
              active ? "text-brand-400" : "text-ink-500 group-hover:text-ink-300"
            }`}
          />
          <span className="truncate">{item.label}</span>
        </div>
        {active ? (
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400 ring-2 ring-brand-400/20" />
          </span>
        ) : null}
      </Link>
    </li>
  );
}

function SidebarNav({ user, onNavigate }: { user: ShellUser; onNavigate?: () => void }) {
  return (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3.5 py-4" aria-label="Dashboard navigation">
      <div>
        <div className="flex items-center justify-between px-3 pb-2">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
            Workspace
          </p>
        </div>
        <ul className="space-y-1">
          {WORKSPACE_NAV.map((item) => (
            <NavLink key={item.href} item={item} onNavigate={onNavigate} />
          ))}
        </ul>
      </div>

      <div>
        <div className="flex items-center justify-between px-3 pb-2">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
            Account &amp; Billing
          </p>
        </div>
        <ul className="space-y-1">
          {ACCOUNT_NAV.map((item) => (
            <NavLink key={item.href} item={item} onNavigate={onNavigate} />
          ))}
        </ul>
      </div>

      {user.role === "admin" ? (
        <div className="pt-2">
          <div className="flex items-center justify-between px-3 pb-2">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
              Administration
            </p>
          </div>
          <Link
            href="/admin"
            onClick={onNavigate}
            className="flex items-center justify-between rounded-lg border border-brand-500/20 bg-brand-500/5 px-3 py-2 text-xs font-semibold text-brand-300 transition-colors hover:border-brand-500/40 hover:bg-brand-500/10 focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            <div className="flex items-center gap-2.5">
              <IconTerminal className="h-4 w-4 text-brand-400" />
              <span>Admin Console</span>
            </div>
            <span className="rounded bg-brand-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-brand-200">
              Admin
            </span>
          </Link>
        </div>
      ) : null}
    </nav>
  );
}

function AccountFooter({ user, onNavigate }: { user: ShellUser; onNavigate?: () => void }) {
  return (
    <div className="border-t border-white/[0.07] p-3.5">
      <div className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-ink-900/60 p-2.5">
        {user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.avatarUrl}
            alt={user.login}
            width={32}
            height={32}
            className="h-8 w-8 shrink-0 rounded-full ring-1 ring-white/15"
          />
        ) : (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/[0.1] bg-ink-800 font-mono text-xs font-bold text-ink-200">
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
          title="View GitHub profile"
          className="rounded-md p-1.5 text-ink-400 transition-colors hover:bg-white/[0.06] hover:text-white"
        >
          <IconExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
      <a
        href="/auth/logout"
        onClick={onNavigate}
        className="mt-2 flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-ink-400 transition-colors hover:bg-danger-500/10 hover:text-danger-300"
      >
        <IconLogOut className="h-3.5 w-3.5 shrink-0" />
        <span>Sign out</span>
      </a>
    </div>
  );
}

function SidebarBody({ user, onNavigate }: { user: ShellUser; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center justify-between border-b border-white/[0.07] px-4">
        <BatonLogo href="/dashboard" size="sm" showBadge={false} />
        <span className="inline-flex items-center gap-1 rounded border border-white/[0.08] bg-ink-900/60 px-1.5 py-0.5 font-mono text-[10px] text-ink-400">
          v0.1
        </span>
      </div>
      <SidebarNav user={user} onNavigate={onNavigate} />
      <AccountFooter user={user} onNavigate={onNavigate} />
    </div>
  );
}

export function AppShell({ user, children }: { user: ShellUser; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

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

  // Derive current section label for breadcrumb
  const currentItem = [...WORKSPACE_NAV, ...ACCOUNT_NAV].find((i) => isActive(pathname, i));
  const pageCategory = WORKSPACE_NAV.some((i) => isActive(pathname, i))
    ? "Workspace"
    : "Account & Billing";

  return (
    <div className="min-h-screen bg-ink-950 text-ink-100 antialiased">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-white/[0.08] bg-ink-950 lg:block">
        <SidebarBody user={user} />
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-white/[0.07] bg-ink-950/90 px-4 backdrop-blur-md lg:hidden">
        <div className="flex items-center gap-2">
          <BatonLogo href="/dashboard" size="sm" showBadge={false} />
          {currentItem ? (
            <>
              <IconChevronRight className="h-3 w-3 text-ink-600" />
              <span className="truncate text-xs font-semibold text-ink-200">
                {currentItem.label}
              </span>
            </>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {user.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.avatarUrl}
              alt={user.login}
              width={28}
              height={28}
              className="h-7 w-7 rounded-full ring-1 ring-white/20"
            />
          ) : null}
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open navigation menu"
            aria-expanded={open}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.1] bg-ink-900 text-ink-200 transition-colors hover:bg-ink-850 hover:text-white focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            <IconMenu className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* Mobile navigation sheet */}
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            aria-hidden="true"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/75 backdrop-blur-sm transition-opacity"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Dashboard navigation menu"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col border-r border-white/[0.1] bg-ink-950 shadow-2xl transition-transform"
          >
            <div className="flex h-14 items-center justify-between border-b border-white/[0.07] px-4">
              <BatonLogo href="/dashboard" size="sm" showBadge={false} />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation menu"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.1] bg-ink-900 text-ink-300 transition-colors hover:bg-ink-850 hover:text-white"
              >
                <IconX className="h-4 w-4" />
              </button>
            </div>
            <SidebarBody user={user} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      ) : null}

      {/* Main content container */}
      <div className="lg:pl-64">
        {/* Desktop Topbar Header */}
        <div className="hidden h-14 items-center justify-between border-b border-white/[0.07] bg-ink-950/70 px-6 backdrop-blur-sm lg:flex">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-mono text-ink-500">{pageCategory}</span>
            <IconChevronRight className="h-3 w-3 text-ink-600" />
            <span className="font-semibold text-white">
              {currentItem?.label ?? "Overview"}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/dashboard/repos"
              className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-ink-900/60 px-2.5 py-1 text-xs font-medium text-ink-300 transition-colors hover:border-white/[0.16] hover:bg-ink-850 hover:text-white"
            >
              <IconGitHub className="h-3 w-3" />
              <span>Repositories</span>
            </Link>

            {user.role === "admin" ? (
              <Link
                href="/admin"
                className="inline-flex items-center gap-1.5 rounded-md border border-brand-500/30 bg-brand-500/10 px-2.5 py-1 text-xs font-medium text-brand-200 transition-colors hover:bg-brand-500/20"
              >
                <IconTerminal className="h-3 w-3 text-brand-400" />
                <span>Admin Console</span>
              </Link>
            ) : null}
          </div>
        </div>

        <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}