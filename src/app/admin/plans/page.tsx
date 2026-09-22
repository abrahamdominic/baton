import Link from "next/link";
import { listPlans, getPlanById } from "@/lib/billing/plans";
import { PlanForm } from "./plan-form";
import { IconArrowLeft, IconLayers } from "@/components/icons";
import { EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AdminPlansPage({
  searchParams,
}: {
  searchParams?: Promise<{ edit?: string; create?: string }>;
}) {
  const [plans, params] = await Promise.all([
    listPlans({ includeInactive: true }).catch(() => []),
    searchParams ? searchParams : Promise.resolve(undefined),
  ]);

  const editing = params?.edit ? await getPlanById(params.edit).catch(() => null) : null;
  const creating = Boolean(params?.create);

  return (
    <div className="space-y-8">
      {/* Header */}
      <PageHeader
        eyebrow="Admin &middot; Catalog"
        title="Plan Catalog"
        description="Configure subscription tiers served on the public pricing page and checkout flow. All plan modifications are audited."
        actions={
          <div className="flex items-center gap-2">
            <Link href="/admin" className="btn btn-ghost btn-sm">
              <IconArrowLeft className="h-3 w-3" />
              <span>Control Panel</span>
            </Link>
            {!creating && !editing ? (
              <Link href="/admin/plans?create=1" className="btn btn-primary btn-sm">
                + New Plan
              </Link>
            ) : null}
          </div>
        }
      />

      {/* Edit / Create Form Panel */}
      {editing || creating ? (
        <section className="overflow-hidden rounded-xl border border-white/[0.12] bg-ink-900/80 p-6 shadow-xl">
          <div className="mb-5 flex items-center justify-between border-b border-white/[0.08] pb-4">
            <h2 className="text-base font-bold text-white">
              {editing ? `Edit Plan: ${editing.name}` : "Create New Subscription Plan"}
            </h2>
            <Link href="/admin/plans" className="btn btn-ghost btn-sm">
              Cancel
            </Link>
          </div>
          <PlanForm plan={editing} />
        </section>
      ) : null}

      {/* Plan Catalog List */}
      <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm">
        <div className="border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
          <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
            {plans.length} Configured Plans
          </span>
        </div>

        {plans.length === 0 ? (
          <div className="p-8">
            <EmptyState
              icon={IconLayers}
              title="No plans created yet"
              hint="Create your first subscription tier to enable paid checkout on the platform."
              action={
                <Link href="/admin/plans?create=1" className="btn btn-primary btn-sm">
                  + Create First Plan
                </Link>
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {plans.map((p) => {
              const monthlyUsd = (p.monthly_price_cents / 100).toFixed(2);
              const annualUsd = (p.annual_price_cents / 100).toFixed(2);

              return (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6 transition-colors hover:bg-white/[0.015]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <p className="text-base font-bold text-white">{p.name}</p>
                      <code className="rounded bg-white/[0.04] px-1.5 py-0.5 font-mono text-[11px] text-ink-400">
                        /plans/{p.slug}
                      </code>
                      {!p.is_active ? (
                        <span className="rounded bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-ink-400">
                          archived
                        </span>
                      ) : (
                        <span className="rounded bg-signal-500/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-signal-300">
                          active
                        </span>
                      )}
                      {!p.is_public ? (
                        <span className="rounded bg-warn-500/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-warn-300">
                          hidden
                        </span>
                      ) : null}
                      {p.price_custom ? (
                        <span className="rounded bg-brand-500/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-brand-300">
                          custom pricing
                        </span>
                      ) : null}
                    </div>

                    <p className="mt-1 text-xs text-ink-300">{p.description}</p>

                    <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-ink-300">
                      <span>
                        <strong className="text-white">${monthlyUsd}</strong>/mo
                      </span>
                      <span className="text-ink-600">&middot;</span>
                      <span>
                        <strong className="text-white">${annualUsd}</strong>/yr
                      </span>
                      {p.stripe_monthly_price_id || p.stripe_annual_price_id ? (
                        <>
                          <span className="text-ink-600">&middot;</span>
                          <span className="text-brand-300">Stripe Linked</span>
                        </>
                      ) : null}
                      <span className="text-ink-600">&middot;</span>
                      <span className="text-ink-500">sort: {p.sort_order}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Link href={`/admin/plans?edit=${p.id}`} className="btn btn-ghost btn-sm">
                      Edit Plan
                    </Link>
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