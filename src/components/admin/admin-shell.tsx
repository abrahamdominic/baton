"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BatonLogo } from "@/components/logo";
import {
  IconGauge,
  IconUser,
  IconShield,
  IconActivity,
  IconSettings,
  IconExternalLink,
  IconLogOut,
  IconLayers,
  IconLock,
  IconGift,
  IconGitHub,
  IconMenu,
  IconX,
  IconArrowLeft,
  IconChevronRight,
} from "@/components/icons";

export interface AdminNavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
}

export interface AdminNavGroup {
  title: string;
  items: AdminNavItem[];
}

const NAV_GROUPS: AdminNavGroup[] = [
  {
    title: "Overview",
    items: [
      { href: "/admin", label: "Control Panel", icon: IconGauge, exact: true },
      { href: "/admin/analytics", label: "Analytics & Funnels", icon: IconActivity },
    ],
  },
  {
    title: "Access & Security",
    items: [
      { href: "/admin/users", label: "Users & Roles", icon: IconUser },
      { href: "/admin/audit", label: "Audit Log", icon: IconLock },
    ],
  },
  {
    title: "Billing & Plans",
    items: [
      { href: "/admin/subscriptions", label: "Subscriptions", icon: IconLayers },
      { href: "/admin/plans", label: "Plan Catalog", icon: IconLayers },
      { href: "/admin/payments", label: "Crypto Payments", icon: IconShield },
      { href: "/admin/gifts", label: "Gift Plans", icon: IconGift },
    ],
  },
  {
    title: "Operations & Health",
    items: [
      { href: "/admin/github", label: "GitHub Integrations", icon: IconGitHub },
      { href: "/admin/health", label: "System Health", icon: IconGauge },
      { href: "/admin/settings", label: "Environment & Config", icon: IconSettings },
    ],
  },
];

const ALL_NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

function isActive(pathname: string, item: AdminNavItem): boolean {
  if (item.exact) return pathname === item.href || pathname === `${item.href}/`;
  return pathname.startsWith(item.href);
}

export interface AdminInfo {
  login: string;
  name?: string | null;
  avatarUrl?: string | null;
  githubUrl: string;
}

function AdminNavLink({
  item,
  onNavigate,
}: {
  item: AdminNavItem;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = isActive(pathname, item);

  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={`group relative flex items-center justify-between rounded-lg px-3 py-2 text-xs font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-1 focus-visible:ring-offset-ink-950 ${
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
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400 ring-2 ring-brand-400/20" />
        ) : null}
      </Link>
    </li>
  );
}

function AdminSidebarContent({
  admin,
  onNavigate,
}: {
  admin: AdminInfo;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      {/* Brand & Badge */}
      <div className="flex h-16 items-center justify-between border-b border-white/[0.07] px-4">
        <div className="flex items-center gap-2.5">
          <BatonLogo href="/admin" size="sm" showBadge={false} />
          <span className="rounded bg-brand-500/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-brand-300 ring-1 ring-brand-500/30">
            Admin
          </span>
        </div>
        <span className="inline-flex items-center gap-1 rounded border border-white/[0.08] bg-ink-900/60 px-1.5 py-0.5 font-mono text-[10px] text-ink-400">
          Superuser
        </span>
      </div>

      {/* Switch to User App */}
      <div className="border-b border-white/[0.06] p-3">
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="flex items-center justify-between rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 text-xs font-medium text-ink-300 transition-colors hover:border-white/[0.16] hover:bg-ink-850 hover:text-white focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          <div className="flex items-center gap-2">
            <IconArrowLeft className="h-3.5 w-3.5 text-ink-400" />
            <span>User Dashboard</span>
          </div>
          <span className="font-mono text-[10px] text-ink-500">/dashboard</span>
        </Link>
      </div>

      {/* Navigation Groups */}
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-3" aria-label="Admin navigation">
        {NAV_GROUPS.map((group) => (
          <div key={group.title}>
            <p className="px-3 pb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
              {group.title}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <AdminNavLink key={item.href} item={item} onNavigate={onNavigate} />
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* Footer Admin Card */}
      <div className="border-t border-white/[0.07] p-3">
        <div className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-ink-900/60 p-2.5">
          {admin.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={admin.avatarUrl}
              alt={admin.login}
              width={32}
              height={32}
              className="h-8 w-8 shrink-0 rounded-full ring-1 ring-white/15"
            />
          ) : (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/[0.1] bg-ink-800 font-mono text-xs font-bold text-ink-200">
              {admin.login.slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-white">@{admin.login}</p>
            <p className="truncate font-mono text-[10px] text-brand-300">Administrator</p>
          </div>
          <a
            href={admin.githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`View @${admin.login} on GitHub`}
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
    </div>
  );
}

export function AdminShell({
  admin,
  children,
}: {
  admin: AdminInfo;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close on Escape and lock body scroll while drawer is open.
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

  // Current page for breadcrumb
  const currentItem = ALL_NAV_ITEMS.find((i) => isActive(pathname, i));
  const currentGroup = NAV_GROUPS.find((g) => g.items.some((i) => isActive(pathname, i)));

  return (
    <div className="min-h-screen bg-ink-950 text-ink-100 antialiased">
      {/* Desktop Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-white/[0.08] bg-ink-950 lg:block">
        <AdminSidebarContent admin={admin} />
      </aside>

      {/* Mobile & Tablet Header */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-white/[0.07] bg-ink-950/90 px-4 backdrop-blur-md lg:hidden">
        <div className="flex items-center gap-2">
          <BatonLogo href="/admin" size="sm" showBadge={false} />
          <span className="rounded bg-brand-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-brand-300 ring-1 ring-brand-500/30">
            Admin
          </span>
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
          <Link
            href="/dashboard"
            className="rounded-md border border-white/[0.08] bg-ink-900/60 px-2.5 py-1 text-xs font-medium text-ink-300 transition-colors hover:text-white"
          >
            User App
          </Link>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open admin navigation menu"
            aria-expanded={open}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.1] bg-ink-900 text-ink-200 transition-colors hover:bg-ink-850 hover:text-white focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            <IconMenu className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* Mobile Drawer */}
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
            aria-label="Admin control panel navigation"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col border-r border-white/[0.1] bg-ink-950 shadow-2xl transition-transform"
          >
            <div className="flex h-14 items-center justify-between border-b border-white/[0.07] px-4">
              <div className="flex items-center gap-2">
                <BatonLogo href="/admin" size="sm" showBadge={false} />
                <span className="rounded bg-brand-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-brand-300">
                  Admin
                </span>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close admin menu"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.1] bg-ink-900 text-ink-300 transition-colors hover:bg-ink-850 hover:text-white"
              >
                <IconX className="h-4 w-4" />
              </button>
            </div>
            <AdminSidebarContent admin={admin} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      ) : null}

      {/* Main Content Area */}
      <div className="lg:pl-64">
        {/* Desktop Topbar Breadcrumbs & Switcher */}
        <div className="hidden h-14 items-center justify-between border-b border-white/[0.07] bg-ink-950/70 px-6 backdrop-blur-sm lg:flex">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-mono text-ink-500">Admin</span>
            {currentGroup ? (
              <>
                <IconChevronRight className="h-3 w-3 text-ink-600" />
                <span className="font-mono text-ink-400">{currentGroup.title}</span>
              </>
            ) : null}
            <IconChevronRight className="h-3 w-3 text-ink-600" />
            <span className="font-semibold text-white">
              {currentItem?.label ?? "Control Panel"}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-full border border-white/[0.06] bg-ink-900/60 px-2.5 py-1">
              <span className="h-1.5 w-1.5 rounded-full bg-signal-400 ring-2 ring-signal-400/20" />
              <span className="font-mono text-[10px] font-medium text-signal-400">Admin Mode Active</span>
            </div>

            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-ink-900/60 px-2.5 py-1 text-xs font-medium text-ink-300 transition-colors hover:border-white/[0.16] hover:bg-ink-850 hover:text-white"
            >
              <IconArrowLeft className="h-3 w-3" />
              <span>Exit to User App</span>
            </Link>
          </div>
        </div>

        <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}