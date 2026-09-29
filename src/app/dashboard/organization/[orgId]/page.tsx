import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import {
  getEntitlement,
  getWorkspacePaidSubscription,
  hasFeature,
  FEATURE_KEYS,
} from "@/lib/billing/entitlement";
import { requireOrganizationMember } from "@/lib/workspaces";
import { myInstallations } from "@/lib/queries/dashboard";
import { Badge, EmptyState, PageHeader, StatCard } from "@/components/ui";
import {
  IconBuilding,
  IconGitHub,
  IconChevronRight,
  IconArrowRight,
  IconGitPullRequest,
  IconBranch,
  IconSettings,
  IconDownload,
  IconShield,
  IconLock,
  IconSend,
} from "@/components/icons";
import { updateOrganization } from "../actions";
import { getTranslatorForRequest } from "@/lib/i18n/server-t";
import {
  InviteForm,
  RoleSelectForm,
  RemoveMemberButton,
  RevokeInviteButton,
  ShareInstallForm,
  UnshareInstallButton,
  TransferOwnerButton,
  LeaveWorkspaceButton,
  DeleteWorkspaceButton,
  PolicyForm,
} from "@/components/dashboard/workspace-forms";

export const dynamic = "force-dynamic";

export default async function OrganizationDetailPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { t } = await getTranslatorForRequest();
  const { orgId } = await params;
  const user = await currentUser();
  if (!user) return null;

  const { role } = await requireOrganizationMember(orgId, user.id).catch(() => ({
    role: "" as string,
  }));
  if (!role) notFound();

  const [org, myInstalls, scopeEntitlement] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: orgId },
      include: {
        owner: { select: { id: true, login: true } },
        members: {
          include: { user: { select: { id: true, login: true, name: true, avatarUrl: true } } },
          orderBy: { createdAt: "asc" },
        },
        invites: {
          where: { status: "pending" },
          include: { invitedBy: { select: { login: true } } },
          orderBy: { createdAt: "desc" },
        },
        installations: {
          include: {
            installation: {
              include: { repos: { select: { id: true, owner: true, name: true } } },
            },
          },
          orderBy: { createdAt: "asc" },
        },
        policy: true,
      },
    }),
    user.role === "admin" || role === "admin" || role === "owner"
      ? myInstallations(user, { allRepos: true })
      : Promise.resolve([]),
    getEntitlement(user.id, { organizationId: orgId }),
  ]);
  if (!org) notFound();

  const isAdmin = role === "owner" || role === "admin";
  const paid = Boolean(await getWorkspacePaidSubscription(org.ownerId));
  const memberCap = scopeEntitlement.maxMembers;
  const sharedRepos = org.installations.reduce((n, l) => n + l.installation.repos.length, 0);
  const slotLeft = memberCap === null ? null : memberCap - org.members.length - org.invites.length;
  const canShare = paid || user.role === "admin";
  const workspaceFeature = hasFeature(scopeEntitlement, FEATURE_KEYS.organizationWorkspace);
  const canEditPolicy = isAdmin && hasFeature(scopeEntitlement, FEATURE_KEYS.orgPolicies);
  const canExportAudit =
    user.role === "admin" || (isAdmin && hasFeature(scopeEntitlement, FEATURE_KEYS.auditExport));

  const auditCount = canExportAudit
    ? await prisma.auditLog.count({ where: { targetType: "organization", targetId: org.id } })
    : 0;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5 font-mono">
            <IconBuilding className="h-3 w-3" />
            {t("workspace:eyebrow_organization")}
          </span>
        }
        title={org.name}
        description={t("workspace:header_description_org", {
          count: org.members.length,
          owner: org.owner.login,
        })}
        badge={
          <Badge tone={paid ? "success" : "warn"}>
            {t(paid ? "workspace:owner_plan_active" : "workspace:owner_plan_inactive")}
          </Badge>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/dashboard/organization/${org.id}/board`} className="btn btn-ghost btn-sm">
              <span>{t("workspace:org_board")}</span>
              <IconChevronRight className="h-3 w-3" />
            </Link>
            <Link href={`/dashboard/organization/${org.id}/messaging`} className="btn btn-ghost btn-sm">
              <IconSend className="h-3.5 w-3.5" />
              <span>{t("workspace:tab_messages")}</span>
            </Link>
            {canExportAudit ? (
              <Link
                href={`/dashboard/organization/${org.id}/audit`}
                className="btn btn-ghost btn-sm"
              >
                <IconDownload className="h-3.5 w-3.5" />
                <span>{t("workspace:audit_ledger")}</span>
              </Link>
            ) : null}
          </div>
        }
      />

      {!paid && user.id === org.ownerId ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn-500/25 bg-warn-500/[0.06] px-4 py-3 text-xs text-ink-300">
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-warn-400" />
            <p className="leading-relaxed">
              <span className="font-semibold text-white">
                {t("workspace:free_mode_lead_org")}
              </span>{" "}
              {t("workspace:free_mode_tail_org")}
            </p>
          </div>
          <Link href="/dashboard/billing" className="btn btn-secondary btn-sm shrink-0">
            {t("workspace:activate_plan_org")}
          </Link>
        </div>
      ) : null}

      <section className="grid grid-cols-2 gap-3.5 sm:gap-4 lg:grid-cols-4">
        <StatCard label={t("workspace:stat_members")} value={org.members.length} icon={IconBuilding} />
        <StatCard
          label={t("workspace:stat_shared_accounts")}
          value={org.installations.length}
          detail={t("workspace:repos_under_policy", { count: sharedRepos })}
          tone={org.installations.length > 0 ? "brand" : "default"}
          icon={IconGitHub}
        />
        <StatCard
          label={t("workspace:stat_pending_invites")}
          value={org.invites.length}
          tone={org.invites.length > 0 ? "warn" : "default"}
          icon={IconGitPullRequest}
        />
        <StatCard
          label={t("workspace:plan")}
          value={
            scopeEntitlement.source === "workspace" && paid
              ? scopeEntitlement.planName
              : t("workspace:free")
          }
          detail={t(
            slotLeft === null
              ? "workspace:unlimited_member_cap"
              : "workspace:member_slots_left",
            slotLeft === null ? undefined : { count: Math.max(0, slotLeft) },
          )}
          tone={workspaceFeature && paid ? "brand" : "warn"}
          icon={IconShield}
        />
      </section>

      {/* Member table */}
      <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm">
        <div className="flex items-center justify-between border-b border-white/[0.08] bg-ink-950/70 px-5 py-3">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-400">
            {t("workspace:members")}
          </span>
          {isAdmin && canShare ? (
            <span className="font-mono text-[11px] text-ink-500">
              {t(
                slotLeft === null ? "workspace:unlimited_cap" : "workspace:slots_left",
                slotLeft === null ? undefined : { count: Math.max(0, slotLeft) },
              )}
            </span>
          ) : null}
        </div>
        <ul className="divide-y divide-white/[0.05]">
          {org.members.map((m) => {
            const isMe = m.userId === user.id;
            const isOwner = m.role === "owner";
            return (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                <div className="flex min-w-0 items-center gap-3">
                  {m.user.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.user.avatarUrl}
                      alt={m.user.login}
                      width={32}
                      height={32}
                      className="h-8 w-8 shrink-0 rounded-full ring-1 ring-white/15"
                    />
                  ) : (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/[0.1] bg-ink-800 font-mono text-xs font-bold text-ink-200">
                      {m.user.login.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-white">
                      {m.user.name ?? m.user.login}
                      {isMe ? (
                        <span className="ml-1.5 text-ink-500">{t("workspace:you_suffix")}</span>
                      ) : null}
                    </p>
                    <a
                      href={`https://github.com/${encodeURIComponent(m.user.login)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate font-mono text-[11px] text-ink-400 transition-colors hover:text-brand-300"
                    >
                      @{m.user.login}
                    </a>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {!isMe ? (
                    <Link
                      href={`/dashboard/organization/${org.id}/messaging?member=${encodeURIComponent(m.userId)}`}
                      className="btn btn-ghost btn-sm"
                      aria-label={t("workspace:message_aria", { login: m.user.login })}
                    >
                      <IconSend className="h-3.5 w-3.5" />
                      <span>{t("workspace:message")}</span>
                    </Link>
                  ) : null}
                  {isOwner ? (
                    <span className="rounded-full border border-brand-500/25 bg-brand-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-brand-300">
                      {t("workspace:role_owner")}
                    </span>
                  ) : isAdmin ? (
                    <RoleSelectForm
                      kind="organization"
                      workspaceId={org.id}
                      userId={m.userId}
                      currentRole={m.role}
                      login={m.user.login}
                    />
                  ) : (
                    <span className="rounded-full border border-white/[0.08] bg-ink-850 px-2 py-0.5 font-mono text-[10px] text-ink-300">
                      {m.role}
                    </span>
                  )}
                  {isAdmin && !isOwner && !isMe ? (
                    <RemoveMemberButton
                      kind="organization"
                      workspaceId={org.id}
                      userId={m.userId}
                      login={m.user.login}
                    />
                  ) : null}
                  {role === "owner" && !isOwner && !isMe ? (
                    <TransferOwnerButton
                      kind="organization"
                      workspaceId={org.id}
                      userId={m.userId}
                      login={m.user.login}
                      name={m.user.name}
                      avatarUrl={m.user.avatarUrl}
                    />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Invitations */}
      <section className="rounded-xl border border-white/[0.08] bg-ink-900/60 p-5 shadow-sm">
        <h2 className="text-sm font-bold text-white">{t("workspace:invitations")}</h2>
        <p className="mb-4 mt-1 text-xs leading-relaxed text-ink-400">
          {t("workspace:invitations_hint_org")}
        </p>
        {isAdmin ? (
          <div className="mb-5 rounded-lg border border-white/[0.06] bg-ink-950/60 p-4">
            <InviteForm kind="organization" workspaceId={org.id} />
          </div>
        ) : null}
        {org.invites.length === 0 ? (
          <p className="text-xs text-ink-500">{t("workspace:no_pending_invitations")}</p>
        ) : (
          <ul className="divide-y divide-white/[0.05] rounded-lg border border-white/[0.06]">
            {org.invites.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-mono text-xs font-semibold text-white">@{inv.githubLogin}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-ink-500">
                    {t(`workspace:role_${inv.role}`)} &middot;{" "}
                    {t("workspace:invited_by", { login: inv.invitedBy.login })}
                  </p>
                </div>
                {isAdmin ? (
                  <RevokeInviteButton
                    kind="organization"
                    workspaceId={org.id}
                    githubLogin={inv.githubLogin}
                    email={inv.email}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Shared repositories */}
      <section className="rounded-xl border border-white/[0.08] bg-ink-900/60 p-5 shadow-sm">
        <h2 className="text-sm font-bold text-white">{t("workspace:shared_board_scope")}</h2>
        <p className="mb-4 mt-1 text-xs leading-relaxed text-ink-400">
          {t("workspace:shared_board_scope_hint_org")}
        </p>
        {isAdmin ? (
          <div className="mb-5 rounded-lg border border-white/[0.06] bg-ink-950/60 p-4">
            {myInstalls.length === 0 ? (
              <p className="text-xs text-ink-500">
                {t("workspace:no_installations")}{" "}
                <Link href="/dashboard/repos" className="font-semibold text-brand-300 hover:text-brand-200">
                  {t("workspace:connect_one_first")}
                </Link>
                .
              </p>
            ) : !canShare ? (
              <p className="text-xs text-ink-500">
                {t("workspace:sharing_requires_plan_org")}
              </p>
            ) : (
              <ShareInstallForm
                kind="organization"
                workspaceId={org.id}
                installations={myInstalls.map((i) => ({
                  id: i.id,
                  installationId: i.installationId,
                  accountLogin: i.accountLogin,
                }))}
              />
            )}
          </div>
        ) : null}
        {org.installations.length === 0 ? (
          <EmptyState
            icon={IconBranch}
            title={t("workspace:nothing_shared_title")}
            hint={t(
              isAdmin ? "workspace:nothing_shared_admin_org" : "workspace:nothing_shared_member",
            )}
          />
        ) : (
          <ul className="space-y-2">
            {org.installations.map((link) => (
              <li
                key={link.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-ink-950/60 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="font-mono text-xs font-semibold text-white">
                    @{link.installation.accountLogin}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-ink-500">
                    {t("workspace:repos_shared", { count: link.installation.repos.length })}
                  </p>
                </div>
                {isAdmin ? (
                  <UnshareInstallButton
                    kind="organization"
                    workspaceId={org.id}
                    installationId={link.installationId}
                    account={link.installation.accountLogin}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Organization-wide policy */}
      <section className="rounded-xl border border-white/[0.08] bg-ink-900/60 p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-white">
              <IconSettings className="h-4 w-4 text-ink-400" />
              {t("workspace:org_policy_title")}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-ink-400">
              {t("workspace:org_policy_hint")}
            </p>
          </div>
          {!hasFeature(scopeEntitlement, FEATURE_KEYS.orgPolicies) ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-500/25 bg-brand-500/10 px-2.5 py-1 font-mono text-[10px] font-semibold text-brand-300">
              <IconLock className="h-3 w-3" />
              {t("workspace:org_plan_badge")}
            </span>
          ) : null}
        </div>

        <div className="mt-5">
          {canEditPolicy ? (
            <PolicyForm
              organizationId={org.id}
              initial={
                org.policy
                  ? {
                      firstResponseHours: org.policy.firstResponseHours,
                      reviewFollowUpHours: org.policy.reviewFollowUpHours,
                      changesRequiredHours: org.policy.changesRequiredHours,
                      ciFailHours: org.policy.ciFailHours,
                      conflictHours: org.policy.conflictHours,
                      readyToMergeHours: org.policy.readyToMergeHours,
                      maxNudgesPerState: org.policy.maxNudgesPerState,
                    }
                  : {
                      firstResponseHours: 24,
                      reviewFollowUpHours: 36,
                      changesRequiredHours: 72,
                      ciFailHours: 24,
                      conflictHours: 12,
                      readyToMergeHours: 48,
                      maxNudgesPerState: 1,
                    }
              }
            />
          ) : (
            <EmptyState
              icon={IconLock}
              title={t(
                isAdmin ? "workspace:org_policy_locked_admin" : "workspace:org_policy_locked_member",
              )}
              hint={t(
                isAdmin ? "workspace:org_policy_locked_hint_admin" : "workspace:org_policy_locked_hint_member",
              )}
              action={
                isAdmin ? (
                  <Link href="/dashboard/billing" className="btn btn-secondary btn-sm">
                    {t("workspace:upgrade_plan")}
                  </Link>
                ) : undefined
              }
            />
          )}
        </div>
      </section>

      {isAdmin ? (
        <section className="rounded-xl border border-white/[0.08] bg-ink-900/60 p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-bold text-white">
            <IconSettings className="h-4 w-4 text-ink-400" />
            {t("workspace:settings_title_org")}
          </h2>
          <form
            action={async (formData) => {
              "use server";
              await updateOrganization({
                organizationId: org.id,
                name: String(formData.get("name") ?? ""),
                slug: String(formData.get("slug") ?? ""),
              });
            }}
            className="mt-4 flex flex-wrap items-end gap-2"
          >
            <div className="flex-1 min-w-52">
              <label htmlFor="org-name" className="mb-1 block text-[11px] font-semibold text-ink-400">
                {t("workspace:name_label_org")}
              </label>
              <input
                id="org-name"
                name="name"
                defaultValue={org.name}
                className="input h-9 w-full text-sm"
                required
              />
            </div>
            <div className="flex-1 min-w-40">
              <label htmlFor="org-slug" className="mb-1 block text-[11px] font-semibold text-ink-400">
                {t("workspace:slug_label")}
              </label>
              <input
                id="org-slug"
                name="slug"
                defaultValue={org.slug}
                className="input h-9 w-full font-mono text-xs"
                spellCheck={false}
              />
            </div>
            <button type="submit" className="btn btn-secondary btn-sm h-9">
              {t("workspace:save_changes")}
            </button>
          </form>
        </section>
      ) : null}

      {/* Audit trail */}
      {canExportAudit ? (
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/[0.08] bg-ink-900/60 p-5 shadow-sm">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-bold text-white">
              <IconDownload className="h-4 w-4 text-ink-400" />
              {t("workspace:audit_trail")}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-ink-400">
              {t("workspace:audit_trail_hint", { count: auditCount })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={`/api/org-audit/${org.id}?format=csv`}
              className="btn btn-ghost btn-sm"
            >
              <IconDownload className="h-3.5 w-3.5" />
              <span>{t("workspace:export_csv")}</span>
            </a>
            <a
              href={`/api/org-audit/${org.id}?format=json`}
              className="btn btn-ghost btn-sm"
            >
              <span>{t("workspace:export_json")}</span>
            </a>
          </div>
        </section>
      ) : null}

      {/* Danger zone */}
      <section className="rounded-xl border border-danger-500/20 bg-danger-500/[0.03] p-5">
        <h2 className="flex items-center gap-2 text-sm font-bold text-white">
          <IconArrowRight className="h-4 w-4 text-ink-500" />
          {t("workspace:danger_zone")}
        </h2>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs">
          <p className="text-ink-400">
            {t(
              role === "owner"
                ? "workspace:danger_delete_owner_org"
                : "workspace:danger_leave_member_org",
            )}
          </p>
          <div className="flex items-center gap-2">
            {role === "owner" ? (
              <DeleteWorkspaceButton
                kind="organization"
                workspaceId={org.id}
                name={org.name}
              />
            ) : (
              <LeaveWorkspaceButton kind="organization" workspaceId={org.id} />
            )}
          </div>
        </div>
      </section>
    </div>
  );
}