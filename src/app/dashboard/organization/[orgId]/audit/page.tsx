import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getEntitlement, hasFeature, FEATURE_KEYS } from "@/lib/billing/entitlement";
import { organizationAuditLog, requireOrganizationMember } from "@/lib/workspaces";
import { getTranslatorForRequest } from "@/lib/i18n/server-t";
import { PageHeader, EmptyState } from "@/components/ui";
import { IconBuilding, IconDownload, IconArrowLeft } from "@/components/icons";

export const dynamic = "force-dynamic";

function NiceDate({ date, format }: { date: Date; format: (v: Date) => string }) {
  return <span className="font-mono text-[11px] text-ink-400">{format(date)}</span>;
}

export default async function OrganizationAuditPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const { t, formatDateTime } = await getTranslatorForRequest();
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
            {t("workspace:audit_trail")}
          </span>
        }
        title={t("workspace:audit_ledger_title", { org: org.name })}
        description={t("workspace:audit_ledger_description")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/dashboard/organization/${org.id}`} className="btn btn-ghost btn-sm">
              <IconArrowLeft className="h-3.5 w-3.5" />
              <span>{t("workspace:back_to_org")}</span>
            </Link>
            <a href={`/api/org-audit/${org.id}?format=csv`} className="btn btn-primary btn-sm">
              <IconDownload className="h-3.5 w-3.5" />
              <span>{t("workspace:export_csv")}</span>
            </a>
            <a href={`/api/org-audit/${org.id}?format=json`} className="btn btn-ghost btn-sm">
              <span>{t("workspace:export_json")}</span>
            </a>
          </div>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={IconBuilding}
          title={t("workspace:audit_empty_title")}
          hint={t("workspace:audit_empty_hint")}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm">
          <div className="flex items-center justify-between border-b border-white/[0.08] bg-ink-950/70 px-5 py-3">
            <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
              {t("workspace:event_count", { count: rows.length })}
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
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px] text-ink-500">
                    {r.user ? (
                      <>
                        <span className="font-semibold text-ink-200">@{r.user.login}</span>
                        {r.user.name && r.user.name !== r.user.login ? (
                          <span className="text-ink-400">({r.user.name})</span>
                        ) : null}
                        <span className="text-ink-600">user {r.userId?.slice(0, 12)}…</span>
                      </>
                    ) : (
                      <span className="text-ink-300">actor @{r.actor}</span>
                    )}
                    <span className="text-ink-600">· recorded actor {r.actor}</span>
                    {r.ip ? <span className="text-ink-600">· {r.ip}</span> : null}
                  </p>
                </div>
                <NiceDate date={r.createdAt} format={formatDateTime} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}