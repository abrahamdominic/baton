import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getEntitlement, getWorkspacePaidSubscription } from "@/lib/billing/entitlement";
import { requireTeamMember } from "@/lib/workspaces";
import { myInstallations } from "@/lib/queries/dashboard";
import { Badge, EmptyState, PageHeader, StatCard } from "@/components/ui";
import {
  IconUsers,
  IconGitHub,
  IconChevronRight,
  IconArrowRight,
  IconGitPullRequest,
  IconBranch,
  IconSettings,
  IconSend,
} from "@/components/icons";
import { updateTeam } from "../actions";
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
} from "@/components/dashboard/workspace-forms";

export const dynamic = "force-dynamic";

export default async function TeamDetailPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { t } = await getTranslatorForRequest();
  const { teamId } = await params;
  const user = await currentUser();
  if (!user) return null;

  const { role } = await requireTeamMember(teamId, user.id).catch(() => ({ role: "" as string }));
  if (!role) notFound();

  const [team, myInstalls] = await Promise.all([
    prisma.team.findUnique({
      where: { id: teamId },
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
            installation: { include: { repos: { select: { id: true, owner: true, name: true } } } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
    user.role === "admin" || role === "admin" || role === "owner"
      ? myInstallations(user, { allRepos: true })
      : Promise.resolve([]),
  ]);
  if (!team) notFound();

  const isAdmin = role === "owner" || role === "admin";
  const paid = Boolean(await getWorkspacePaidSubscription(team.ownerId));
  const scopeEntitlement = await getEntitlement(user.id, { teamId });
  const memberCap = scopeEntitlement.maxMembers;
  const sharedRepos = team.installations.reduce((n, l) => n + l.installation.repos.length, 0);
  const canShare = paid || user.role === "admin";
  const slotLeft = memberCap === null ? null : memberCap - team.members.length - team.invites.length;

  const tabs = [
    { href: `/dashboard/team/${team.id}`, label: t("workspace:tab_overview"), active: true },
    { href: `/dashboard/team/${team.id}/board`, label: t("workspace:tab_board") },
    { href: `/dashboard/team/${team.id}/messaging`, label: t("workspace:tab_messages") },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5 font-mono">
            <IconUsers className="h-3 w-3" />
            {t("workspace:eyebrow_team")}
          </span>
        }
        title={team.name}
        description={t("workspace:header_description", {
          count: team.members.length,
          owner: team.owner.login,
        })}
        badge={
          <Badge tone={paid ? "success" : "warn"}>
            {t(paid ? "workspace:owner_plan_active" : "workspace:owner_plan_inactive")}
          </Badge>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {tabs.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className={
                  t.active
                    ? "btn btn-primary btn-sm"
                    : "btn btn-ghost btn-sm"
                }
              >
                <span>{t.label}</span>
                {t.active ? null : <IconChevronRight className="h-3 w-3" />}
              </Link>
            ))}
          </div>
        }
      />

      {!paid && user.id === team.ownerId ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn-500/25 bg-warn-500/[0.06] px-4 py-3 text-xs text-ink-300">
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-warn-400" />
            <p className="leading-relaxed">
              <span className="font-semibold text-white">{t("workspace:free_mode_lead")}</span>{" "}
              {t("workspace:free_mode_tail")}
            </p>
          </div>
          <Link href="/dashboard/billing" className="btn btn-secondary btn-sm shrink-0">
            {t("workspace:activate_plan")}
          </Link>
        </div>
      ) : null}

      <section className="grid grid-cols-2 gap-3.5 sm:gap-4 lg:grid-cols-4">
        <StatCard label={t("workspace:stat_members")} value={team.members.length} icon={IconUsers} />
        <StatCard
          label={t("workspace:stat_shared_accounts")}
          value={team.installations.length}
          detail={t("workspace:repos_on_board", { count: sharedRepos })}
          tone={team.installations.length > 0 ? "brand" : "default"}
          icon={IconGitHub}
        />
        <StatCard
          label={t("workspace:stat_pending_invites")}
          value={team.invites.length}
          tone={team.invites.length > 0 ? "warn" : "default"}
          icon={IconGitPullRequest}
        />
        <StatCard
          label={t("workspace:stat_plan_slot")}
          value={slotLeft === null ? t("workspace:unlimited") : Math.max(0, slotLeft)}
          detail={t(slotLeft === null ? "workspace:no_member_cap" : "workspace:max_members_per_plan")}
          icon={IconUsers}
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
          {team.members.map((m) => {
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
                      href={`/dashboard/team/${team.id}/messaging?member=${encodeURIComponent(m.userId)}`}
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
                      kind="team"
                      workspaceId={team.id}
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
                      kind="team"
                      workspaceId={team.id}
                      userId={m.userId}
                      login={m.user.login}
                    />
                  ) : null}
                  {role === "owner" && !isOwner && !isMe ? (
                    <TransferOwnerButton
                      kind="team"
                      workspaceId={team.id}
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
          {t("workspace:invitations_hint")}
        </p>
        {isAdmin ? (
          <div className="mb-5 rounded-lg border border-white/[0.06] bg-ink-950/60 p-4">
            <InviteForm kind="team" workspaceId={team.id} />
          </div>
        ) : null}
        {team.invites.length === 0 ? (
          <p className="text-xs text-ink-500">{t("workspace:no_pending_invitations")}</p>
        ) : (
          <ul className="divide-y divide-white/[0.05] rounded-lg border border-white/[0.06]">
            {team.invites.map((inv) => (
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
                    kind="team"
                    workspaceId={team.id}
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
          {t("workspace:shared_board_scope_hint")}
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
                {t("workspace:sharing_requires_plan")}
              </p>
            ) : (
              <ShareInstallForm
                kind="team"
                workspaceId={team.id}
                installations={myInstalls.map((i) => ({
                  id: i.id,
                  installationId: i.installationId,
                  accountLogin: i.accountLogin,
                }))}
              />
            )}
          </div>
        ) : null}
        {team.installations.length === 0 ? (
          <EmptyState
            icon={IconBranch}
            title={t("workspace:nothing_shared_title")}
            hint={t(
              isAdmin ? "workspace:nothing_shared_admin" : "workspace:nothing_shared_member",
            )}
          />
        ) : (
          <ul className="space-y-2">
            {team.installations.map((link) => (
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
                    kind="team"
                    workspaceId={team.id}
                    installationId={link.installationId}
                    account={link.installation.accountLogin}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {isAdmin ? (
        <section className="rounded-xl border border-white/[0.08] bg-ink-900/60 p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-bold text-white">
            <IconSettings className="h-4 w-4 text-ink-400" />
            {t("workspace:settings_title")}
          </h2>
          <form
            action={async (formData) => {
              "use server";
              await updateTeam({
                teamId: team.id,
                name: String(formData.get("name") ?? ""),
                slug: String(formData.get("slug") ?? ""),
              });
            }}
            className="mt-4 flex flex-wrap items-end gap-2"
          >
            <div className="flex-1 min-w-52">
              <label htmlFor="team-name" className="mb-1 block text-[11px] font-semibold text-ink-400">
                {t("workspace:name_label")}
              </label>
              <input
                id="team-name"
                name="name"
                defaultValue={team.name}
                className="input h-9 w-full text-sm"
                required
              />
            </div>
            <div className="flex-1 min-w-40">
              <label htmlFor="team-slug" className="mb-1 block text-[11px] font-semibold text-ink-400">
                {t("workspace:slug_label")}
              </label>
              <input
                id="team-slug"
                name="slug"
                defaultValue={team.slug}
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
                ? "workspace:danger_delete_owner"
                : "workspace:danger_leave_member",
            )}
          </p>
          <div className="flex items-center gap-2">
            {role === "owner" ? (
              <DeleteWorkspaceButton kind="team" workspaceId={team.id} name={team.name} />
            ) : (
              <LeaveWorkspaceButton kind="team" workspaceId={team.id} />
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
