import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getEntitlement, hasFeature, FEATURE_KEYS } from "@/lib/billing/entitlement";
import { organizationAuditLog, requireOrganizationMember } from "@/lib/workspaces";
import { PageHeader, EmptyState } from "@/components/ui";
import { IconBuilding, IconDownload, IconArrowLeft } from "@/components/icons";

export const dynamic = "force-dynamic";

function NiceDate({ date }: { date: Date }) {
  const s = date.toLocaleString();
  return <span className="font-mono text-[11px] text-ink-400">{s}</span>;
}

export default async function OrganizationAuditPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const user = await currentUser();
  if (!user) return null;

  const { role } = await requireOrganizationMember(orgId, user.id).catch(() => ({
    role: "" as string,
  }));
  if (!role) notFound();

  const entitlement = await getEntitlement(user.id, { organizationId: orgId });
  const canExport =
    user.role === "admin" ||
    ((role === "owner" || role === "admin") && hasFeature(entitlement, FEATURE_KEYS.auditExport));
  if (!canExport) notFound();

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true },
  });
  if (!org) notFound();

  const rows = await organizationAuditLog(orgId, 500);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5 font-mono">
            <IconBuilding className="h-3 w-3" />
            Audit Trail
          </span>
        }
        title={`${org.name} · Audit Ledger`}
        description="Every member, invite, policy, ownership, and installation change in this organization, newest first. Export the full ledger as CSV or JSON."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/dashboard/organization/${org.id}`} className="btn btn-ghost btn-sm">
              <IconArrowLeft className="h-3.5 w-3.5" />
              <span>Back to org</span>
            </Link>
            <a href={`/api/org-audit/${org.id}?format=csv`} className="btn btn-primary btn-sm">
              <IconDownload className="h-3.5 w-3.5" />
              <span>Export CSV</span>
            </a>
            <a href={`/api/org-audit/${org.id}?format=json`} className="btn btn-ghost btn-sm">
              <span>Export JSON</span>
            </a>
          </div>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={IconBuilding}
          title="No audit events yet"
          hint="Member invitations, role changes, policy updates, and installation sharing will appear here as they happen."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm">
          <div className="flex items-center justify-between border-b border-white/[0.08] bg-ink-950/70 px-5 py-3">
            <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
              {rows.length} event{rows.length === 1 ? "" : "s"}
            </span>
            <span className="font-mono text-[11px] text-ink-500">
              org-scoped trail &middot; immutable
            </span>
          </div>
          <ul className="divide-y divide-white/[0.05]">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-white">
                    <span className="font-mono text-brand-300">{r.action}</span>
                    {r.detailJson ? (
                      <span className="ml-2 font-mono text-[11px] text-ink-400">
                        {r.detailJson}
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-ink-500">
                    actor @{r.actor}
                    {r.ip ? <span className="text-ink-600"> · {r.ip}</span> : null}
                  </p>
                </div>
                <NiceDate date={r.createdAt} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}