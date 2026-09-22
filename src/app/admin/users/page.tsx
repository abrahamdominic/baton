import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { setUserRoleAction, setSuspensionAction } from "./actions";
import { StatCard, PageHeader } from "@/components/ui";
import {
  IconUser,
  IconShield,
  IconAlertCircle,
  IconClock,
  IconArrowLeft,
  IconExternalLink,
} from "@/components/icons";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "Users & Access: Baton Admin",
};

function suffix(n: number): string {
  return n === 1 ? "" : "s";
}

export default async function AdminUsersPage() {
  const [users, sessionCount] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        login: true,
        name: true,
        avatarUrl: true,
        githubId: true,
        role: true,
        suspendedAt: true,
        createdAt: true,
        _count: { select: { installations: true, sessions: true } },
      },
    }),
    prisma.session.count(),
  ]);

  const adminCount = users.filter((u) => u.role === "admin").length;
  const suspendedCount = users.filter((u) => u.suspendedAt).length;

  return (
    <div className="space-y-8">
      {/* Header */}
      <PageHeader
        eyebrow="Admin &middot; Access Control"
        title="User Accounts &amp; Roles"
        description="Inspect registered GitHub accounts, manage administrative roles, and enforce account suspensions with audited confirmation."
        actions={
          <div className="flex items-center gap-2">
            <Link href="/admin" className="btn btn-ghost btn-sm">
              <IconArrowLeft className="h-3 w-3" />
              <span>Control Panel</span>
            </Link>
          </div>
        }
      />

      {/* KPI Cards */}
      <section className="grid grid-cols-2 gap-3.5 sm:gap-4 lg:grid-cols-4">
        <StatCard
          label="Registered Users"
          value={users.length}
          detail="Recent account sign-ups"
          icon={IconUser}
        />
        <StatCard
          label="Active Server Sessions"
          value={sessionCount}
          detail="Valid authentication tokens"
          tone="brand"
          icon={IconClock}
        />
        <StatCard
          label="Administrators"
          value={adminCount}
          detail="Accounts with /admin access"
          tone="signal"
          icon={IconShield}
        />
        <StatCard
          label="Suspended Accounts"
          value={suspendedCount}
          detail={suspendedCount > 0 ? "Denied service access" : "Zero suspended users"}
          tone={suspendedCount > 0 ? "danger" : "default"}
          icon={IconAlertCircle}
        />
      </section>

      {/* User Table List */}
      <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm">
        <div className="flex items-center justify-between border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
          <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
            {users.length} User Records
          </span>
          <span className="font-mono text-[11px] text-ink-500">
            Sorted newest first
          </span>
        </div>

        <ul className="divide-y divide-white/[0.05]">
          {users.map((u) => {
            const isAdmin = u.role === "admin";
            const isSuspended = Boolean(u.suspendedAt);

            return (
              <li
                key={u.id}
                className="p-5 transition-colors hover:bg-white/[0.015]"
              >
                <div className="flex flex-wrap items-center justify-between gap-4">
                  {/* User Profile Info */}
                  <div className="flex items-center gap-3.5 min-w-0">
                    {u.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={u.avatarUrl}
                        alt={u.login}
                        width={40}
                        height={40}
                        className="h-10 w-10 shrink-0 rounded-full ring-1 ring-white/15"
                      />
                    ) : (
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/[0.1] bg-ink-800 font-mono text-sm font-bold text-ink-200">
                        {u.login.slice(0, 1).toUpperCase()}
                      </span>
                    )}

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <a
                          href={`https://github.com/${encodeURIComponent(u.login)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-sm font-bold text-white transition-colors hover:text-brand-300 inline-flex items-center gap-1"
                        >
                          <span>@{u.login}</span>
                          <IconExternalLink className="h-3 w-3 text-ink-500" />
                        </a>
                        {u.name ? (
                          <span className="text-xs text-ink-400">({u.name})</span>
                        ) : null}
                        {isAdmin ? (
                          <span className="rounded bg-brand-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-brand-300 ring-1 ring-brand-500/30">
                            admin
                          </span>
                        ) : null}
                        {isSuspended ? (
                          <span className="rounded bg-danger-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-danger-300 ring-1 ring-danger-500/30">
                            suspended
                          </span>
                        ) : null}
                      </div>

                      <p className="mt-1 font-mono text-[11px] text-ink-400">
                        GitHub ID: {u.githubId} &middot; {u._count.installations} install{suffix(u._count.installations)} &middot;{" "}
                        {u._count.sessions} active session{suffix(u._count.sessions)} &middot; joined{" "}
                        {new Date(u.createdAt).toISOString().slice(0, 10)}
                      </p>
                    </div>
                  </div>

                  {/* Administrative Action Safeguards */}
                  <div className="flex flex-wrap items-center gap-3">
                    {/* Role Toggle */}
                    <form action={setUserRoleAction} className="flex items-center gap-2">
                      <input type="hidden" name="userId" value={u.id} />
                      <input type="hidden" name="role" value={isAdmin ? "user" : "admin"} />
                      <label className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-ink-950/70 px-2.5 py-1 text-xs text-ink-300">
                        <input
                          type="checkbox"
                          name="confirm"
                          aria-label="Confirm role change"
                          className="h-3.5 w-3.5 accent-brand-500 rounded"
                        />
                        <span className="font-mono text-[11px]">confirm</span>
                        <button
                          type="submit"
                          className="btn btn-ghost btn-sm h-7 text-xs ml-1"
                        >
                          {isAdmin ? "Demote" : "Make Admin"}
                        </button>
                      </label>
                    </form>

                    {/* Suspension Toggle */}
                    <form action={setSuspensionAction} className="flex items-center gap-2">
                      <input type="hidden" name="userId" value={u.id} />
                      <input type="hidden" name="suspended" value={isSuspended ? "false" : "true"} />
                      <label className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-ink-950/70 px-2.5 py-1 text-xs text-ink-300">
                        <input
                          type="checkbox"
                          name="confirm"
                          aria-label="Confirm suspension change"
                          className="h-3.5 w-3.5 accent-danger-500 rounded"
                        />
                        <span className="font-mono text-[11px]">confirm</span>
                        <button
                          type="submit"
                          className={`btn btn-ghost btn-sm h-7 text-xs ml-1 ${
                            isSuspended
                              ? "text-signal-300 hover:border-signal-500/40"
                              : "text-ink-400 hover:border-danger-500/40 hover:text-danger-300"
                          }`}
                        >
                          {isSuspended ? "Unsuspend" : "Suspend"}
                        </button>
                      </label>
                    </form>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}