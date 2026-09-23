import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { listGifts } from "@/lib/billing/gifts";
import { listPlans } from "@/lib/billing/plans";
import { GiftForm, type GiftUser, type GiftPlanOption } from "./gift-form";
import { StatCard, PageHeader } from "@/components/ui";
import { IconGift, IconUser, IconClock, IconShield, IconArrowLeft, IconExternalLink } from "@/components/icons";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "Gift Plans: Baton Admin",
};

export default async function AdminGiftsPage() {
  const [users, plans, gifts] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        id: true,
        login: true,
        name: true,
        avatarUrl: true,
        role: true,
        suspendedAt: true,
      },
    }),
    listPlans({ includeInactive: false }),
    listGifts(50),
  ]);

  const userOptions: GiftUser[] = users.map((u) => ({
    id: u.id,
    login: u.login,
    name: u.name,
    avatarUrl: u.avatarUrl,
    role: u.role,
    suspendedAt: u.suspendedAt ? u.suspendedAt.toISOString() : null,
  }));

  const planOptions: GiftPlanOption[] = plans.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    price_custom: p.price_custom,
    monthly_price_cents: p.monthly_price_cents,
    annual_price_cents: p.annual_price_cents,
  }));

  const loginById = new Map(users.map((u) => [u.id, u.login]));

  const now = Date.now();
  const activeGifts = gifts.filter((g) => {
    const end = g.access_ends_at ? new Date(g.access_ends_at).getTime() : null;
    return end === null || end >= now;
  }).length;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Gift Plans"
        description="Grant a real paid plan to a user without any payment. The grant is fully audited, clearly marked as admin-gifted, and expires automatically."
        actions={
          <div className="flex items-center gap-2">
            <Link href="/admin" className="btn btn-ghost btn-sm">
              <IconArrowLeft className="h-3 w-3" />
              <span>Control Panel</span>
            </Link>
          </div>
        }
      />

      <section className="grid grid-cols-2 gap-3.5 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Registered Users" value={users.length} detail="Searchable recipients" icon={IconUser} />
        <StatCard label="Active Gift Grants" value={activeGifts} detail="Currently within their access window" tone="brand" icon={IconGift} />
        <StatCard label="Gifts Recorded" value={gifts.length} detail="Immutable grant ledger" tone="signal" icon={IconClock} />
        <StatCard label="Gift Audit" value="On" detail="Every grant lands in audit_logs" tone="default" icon={IconShield} />
      </section>

      <GiftForm users={userOptions} plans={planOptions} />

      {/* Recent gifts */}
      <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm">
        <div className="flex items-center justify-between border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
          <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
            Recent Gift Grants
          </span>
          <span className="font-mono text-[11px] text-ink-500">Newest first</span>
        </div>

        {gifts.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <IconGift className="mx-auto h-8 w-8 text-ink-600" />
            <p className="mt-3 text-sm text-ink-400">No gifts recorded yet.</p>
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {gifts.map((g) => {
              const end = new Date(g.access_ends_at ?? g.access_started_at);
              const stillActive = !g.access_ends_at || end.getTime() >= now;
              const login = loginById.get(g.user_id);
              return (
                <li key={g.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/[0.1] bg-ink-800 font-mono text-xs font-bold text-ink-200">
                        {(login ?? g.user_id).slice(0, 1).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-semibold text-white">
                            {login ? (
                              <>
                                @{login}
                                <a
                                  href={`https://github.com/${encodeURIComponent(login)}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  aria-label={`View @${login} on GitHub`}
                                  className="ml-1.5 inline-flex text-ink-500 transition-colors hover:text-brand-300"
                                >
                                  <IconExternalLink className="h-3 w-3" />
                                </a>
                              </>
                            ) : (
                              <span className="text-ink-500">{g.user_id}</span>
                            )}
                          </span>
                          {stillActive ? (
                            <span className="rounded bg-signal-500/10 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-signal-300 ring-1 ring-signal-500/25">
                              active
                            </span>
                          ) : (
                            <span className="rounded bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-ink-500 ring-1 ring-white/[0.08]">
                              ended
                            </span>
                          )}
                        </div>
                        <p className="mt-1 font-mono text-[11px] text-ink-400">
                          {g.plan?.name ?? g.plan_id} · {g.months} month{g.months === 1 ? "" : "s"} · by admin{" "}
                          {g.admin_user_id ? String(g.admin_user_id).slice(0, 8) : "—"} ·{" "}
                          {new Date(g.created_at).toISOString().slice(0, 10)}
                        </p>
                        {g.note ? <p className="mt-1 text-xs text-ink-400">“{g.note}”</p> : null}
                      </div>
                    </div>
                    <span className="rounded-md border border-white/[0.08] bg-ink-950/60 px-2.5 py-1 font-mono text-[11px] text-ink-300">
                      until {end.toISOString().slice(0, 10)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}