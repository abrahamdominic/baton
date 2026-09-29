import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { getTranslatorForRequest } from "@/lib/i18n/server-t";
import { listUserOrganizations, requireOrganizationMember, workspaceBoard } from "@/lib/workspaces";
import { getEntitlement, hasFeature, FEATURE_KEYS } from "@/lib/billing/entitlement";
import { PageHeader } from "@/components/ui";
import { IconBuilding, IconDownload, IconChevronRight } from "@/components/icons";
import { WorkspaceBoard } from "@/components/dashboard/workspace-board";

export const dynamic = "force-dynamic";

export default async function OrganizationBoardPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const { t } = await getTranslatorForRequest();
  const user = await currentUser();
  if (!user) return null;

  const { role } = await requireOrganizationMember(orgId, user.id).catch(() => ({
    role: "" as string,
  }));
  if (!role) notFound();

  const [org, board] = await Promise.all([
    listUserOrganizations(user.id).then((os) => os.find((o) => o.id === orgId) ?? null),
    workspaceBoard("organization", orgId),
  ]);

  const entitlement = await getEntitlement(user.id, { organizationId: orgId });
  const canExportAudit =
    user.role === "admin" ||
    ((role === "owner" || role === "admin") && hasFeature(entitlement, FEATURE_KEYS.auditExport));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5 font-mono">
            <IconBuilding className="h-3 w-3" />
            Organization Workspace
          </span>
        }
        title={org ? org.name : "Organization Board"}
        description={t("workspace:org_board_description")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/dashboard/organization/${orgId}`} className="btn btn-ghost btn-sm">
              <span>{t("workspace:manage_org")}</span>
              <IconChevronRight className="h-3 w-3" />
            </Link>
            {canExportAudit ? (
              <Link href={`/dashboard/organization/${orgId}/audit`} className="btn btn-ghost btn-sm">
                <IconDownload className="h-3.5 w-3.5" />
                <span>{t("workspace:audit_ledger_link")}</span>
              </Link>
            ) : null}
          </div>
        }
      />

      <WorkspaceBoard
        items={board.items}
        installAccounts={board.installAccounts}
        repos={board.repos.map((r) => ({ id: r.id, owner: r.owner, name: r.name }))}
      />
    </div>
  );
}