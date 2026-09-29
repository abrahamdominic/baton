import Link from "next/link";
import { getTranslatorForRequest } from "@/lib/i18n/server-t";
import { currentUser } from "@/lib/auth/session";
import { getEntitlement, hasFeature, FEATURE_KEYS } from "@/lib/billing/entitlement";
import { listUserTeams, pendingTeamInvites } from "@/lib/workspaces";
import { Badge, EmptyState, PageHeader, StatCard } from "@/components/ui";
import {
  IconUsers,
  IconChevronRight,
  IconArrowRight,
  IconShield,
  IconGitPullRequest,
} from "@/components/icons";
import { createTeam } from "./actions";
import {
  AcceptInviteButton,
  DeclineInviteButton,
} from "@/components/dashboard/workspace-forms";

export const dynamic = "force-dynamic";

export default async function TeamsPage() {
  const { t } = await getTranslatorForRequest();
  const user = await currentUser();
  if (!user) return null;

  const [teams, invites, entitlement] = await Promise.all([
    listUserTeams(user.id),
    pendingTeamInvites(user.login),
    getEntitlement(user.id),
  ]);
  const canUseTeams = user.role === "admin" || hasFeature(entitlement, FEATURE_KEYS.teamWorkspace);

  const totalMembers = teams.reduce((n, t) => n + t.memberCount, 0);

  return (
    <div className="space-y-8">
      <PageHeader
        badge={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-500/30 bg-brand-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-brand-300">
            <IconUsers className="h-3 w-3" />
            {t("teams:workspaces_badge")}
          </span>
        }
        title={t("teams:teams")}
        description={t("teams:index_description")}
        actions={
          canUseTeams ? (
            <Link href="/dashboard/billing" className="btn btn-ghost btn-sm">
              <IconShield className="h-3.5 w-3.5" />
              <span>{t("teams:manage_plan")}</span>
            </Link>
          ) : undefined
        }
      />

      {invites.length > 0 ? (
        <section className="overflow-hidden rounded-xl border border-brand-500/25 bg-ink-900/50 shadow-sm">
          <div className="flex items-center justify-between border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-brand-300">
              {t("teams:invitations_for_you")}
            </span>
          </div>
          <ul className="divide-y divide-white/[0.05]">
            {invites.map((inv) => (
              <li
                key={inv.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{inv.team.name}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-ink-400">
                    {t("teams:invited_by_as", {
                      login: inv.invitedBy.login,
                      role: t(`workspace:role_${inv.role}`),
                    })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <AcceptInviteButton
                    kind="team"
                    workspaceId={inv.teamId}
                    label={t("teams:accept")}
                  />
                  <DeclineInviteButton kind="team" workspaceId={inv.teamId} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!canUseTeams ? (
        <EmptyState
          icon={IconUsers}
          title={t("teams:teams_require_plan")}
          hint={t("teams:teams_require_plan_hint")}
          action={
            <Link href="/dashboard/billing" className="btn btn-primary btn-sm">
              <span>{t("teams:upgrade_to_team")}</span>
              <IconArrowRight className="h-3.5 w-3.5" />
            </Link>
          }
        />
      ) : (
        <>
          {/* Create team */}
          <section className="rounded-xl border border-white/[0.08] bg-ink-900/60 p-5 shadow-sm">
            <h2 className="text-sm font-bold text-white">{t("teams:create_team")}</h2>
            <p className="mb-4 mt-1 text-xs leading-relaxed text-ink-400">
              The owner&apos;s paid plan activates team limits for every member. Share one of your
              GitHub installations to seed the team board.
            </p>
            <form
              action={async (formData) => {
                "use server";
                await createTeam({
                  name: String(formData.get("name") ?? ""),
                  slug: String(formData.get("slug") ?? ""),
                });
              }}
              className="flex flex-wrap items-end gap-2"
            >
              <div className="flex-1 min-w-52">
                <label htmlFor="team-name" className="mb-1 block text-[11px] font-semibold text-ink-400">
                  Team name
                </label>
                <input
                  id="team-name"
                  name="name"
                  placeholder="e.g. Platform Engineering"
                  autoComplete="off"
                  className="input h-9 w-full text-sm"
                  required
                />
              </div>
              <div className="flex-1 min-w-40">
                <label htmlFor="team-slug" className="mb-1 block text-[11px] font-semibold text-ink-400">
                  Slug <span className="text-ink-500">(optional)</span>
                </label>
                <input
                  id="team-slug"
                  name="slug"
                  placeholder="platform-eng"
                  autoComplete="off"
                  spellCheck={false}
                  className="input h-9 w-full font-mono text-xs"
                />
              </div>
              <button type="submit" className="btn btn-primary btn-sm h-9">
                <span>{t("teams:create_team_action")}</span>
                <IconChevronRight className="h-3.5 w-3.5" />
              </button>
            </form>
          </section>

          {teams.length === 0 ? (
            <EmptyState
              icon={IconUsers}
              title={t("teams:no_teams_yet")}
              hint={t("teams:no_teams_yet_hint")}
            />
          ) : (
            <ul className="space-y-4">
              {teams.map((team) => (
                <li
                  key={team.id}
                  className="rounded-xl border border-white/[0.08] bg-ink-900/60 p-5 shadow-sm transition-all duration-200 hover:border-white/[0.14]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <Link
                          href={`/dashboard/team/${team.id}`}
                          className="truncate text-base font-bold text-white transition-colors hover:text-brand-300"
                        >
                          {team.name}
                        </Link>
                        <span className="rounded border border-white/[0.08] bg-ink-850 px-2 py-0.5 font-mono text-[10px] text-ink-400">
                          {team.slug}
                        </span>
                        <Badge tone={team.paid ? "success" : "warn"}>
                          {team.paid ? "owner plan active" : "owner plan inactive"}
                        </Badge>
                      </div>
                      <p className="mt-1 font-mono text-xs text-ink-400">
                        @{team.ownerLogin} &middot; <span className="text-ink-200">{team.memberCount}</span>{" "}
                        member{team.memberCount === 1 ? "" : "s"}
                        {team.role !== "member" ? (
                          <>
                            <span className="text-ink-600"> &middot; </span>
                            <span className="font-semibold text-brand-300">{team.role}</span>
                          </>
                        ) : null}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {team.pendingInvites > 0 ? (
                        <span className="rounded-full border border-brand-500/25 bg-brand-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-brand-300">
                          {team.pendingInvites} invite{team.pendingInvites === 1 ? "" : "s"} pending
                        </span>
                      ) : null}
                      <Link
                        href={`/dashboard/team/${team.id}/board`}
                        className="btn btn-ghost btn-sm"
                      >
                        <IconGitPullRequest className="h-3.5 w-3.5" />
                        <span>{t("teams:board")}</span>
                        <IconChevronRight className="h-3 w-3" />
                      </Link>
                      <Link href={`/dashboard/team/${team.id}`} className="btn btn-ghost btn-sm">
                        <span>{t("teams:manage")}</span>
                        <IconArrowRight className="h-3 w-3" />
                      </Link>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <section className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
            <StatCard
              label={t("teams:stat_your_teams")}
              value={teams.length}
              detail={t("teams:stat_your_teams_detail")}
              icon={IconUsers}
            />
            <StatCard
              label={t("teams:stat_team_members")}
              value={totalMembers}
              detail={t("teams:stat_team_members_detail")}
              tone="brand"
              icon={IconUsers}
            />
            <StatCard
              label={t("teams:stat_pending_invites")}
              value={invites.length}
              detail={
                invites.length > 0
                  ? t("teams:stat_pending_invites_detail")
                  : t("teams:stat_pending_invites_empty")
              }
              tone={invites.length > 0 ? "warn" : "default"}
              icon={IconGitPullRequest}
            />
          </section>
        </>
      )}
    </div>
  );
}