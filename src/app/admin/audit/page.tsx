import type { Metadata } from "next";
import Link from "next/link";
import { listAdminAudit } from "@/lib/billing/audit";
import { IconArrowLeft, IconLock } from "@/components/icons";
import { EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "Audit Log: Baton Admin",
};

export default async function AdminAuditPage() {
  const audit = await listAdminAudit({ limit: 100 }).catch(() => []);

  return (
    <div className="space-y-8">
      {/* Header */}
      <PageHeader
        eyebrow="Admin &middot; Security &amp; Compliance"
        title="Security Audit Log"
        description="Immutable administrative event ledger. Rows are append-only and cannot be updated, modified, or purged."
        actions={
          <div className="flex items-center gap-2">
            <Link href="/admin" className="btn btn-ghost btn-sm">
              <IconArrowLeft className="h-3 w-3" />
              <span>Control Panel</span>
            </Link>
          </div>
        }
      />

      {/* Audit Log Table */}
      <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm">
        <div className="flex items-center justify-between border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
          <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
            {audit.length} Audit Entries Recorded
          </span>
          <span className="font-mono text-[11px] text-ink-500">
            Append-only verification ledger
          </span>
        </div>

        {audit.length === 0 ? (
          <div className="p-8">
            <EmptyState
              icon={IconLock}
              title="No administrative audit events recorded yet"
              hint="When administrators modify user roles, override subscriptions, or change plan pricing, immutable audit entries will appear here."
            />
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {audit.map((a) => (
              <li
                key={a.id}
                className="p-5 sm:p-6 transition-colors hover:bg-white/[0.015]"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-brand-500/15 px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wider text-brand-300 ring-1 ring-brand-500/30">
                        {a.action}
                      </span>
                      <span className="font-mono text-xs font-semibold text-white">
                        {a.resourceType ?? "system"}
                      </span>
                      {a.resourceId ? (
                        <span className="font-mono text-xs text-ink-400">
                          ID: <code className="rounded bg-white/[0.04] px-1.5 py-0.5 text-ink-200">{a.resourceId}</code>
                        </span>
                      ) : null}
                    </div>

                    <p className="mt-1 font-mono text-[11px] text-ink-400">
                      Actor: <span className="text-ink-200">{a.adminUserId ? `@${a.adminUserId}` : "System / Bootstrap"}</span> &middot; Entry ID: {a.id.slice(0, 16)}&hellip;
                    </p>

                    {a.detail && Object.keys(a.detail).length > 0 ? (
                      <div className="mt-3 rounded-lg border border-white/[0.04] bg-ink-950/70 p-3">
                        <pre className="max-h-36 overflow-x-auto font-mono text-[11px] text-ink-300">
                          {JSON.stringify(a.detail, null, 2)}
                        </pre>
                      </div>
                    ) : null}
                  </div>

                  <span className="shrink-0 font-mono text-xs text-ink-400">
                    {new Date(a.createdAt).toLocaleString("en-US", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}