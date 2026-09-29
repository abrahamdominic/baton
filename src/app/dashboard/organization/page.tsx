import Link from "next/link";
import { getTranslatorForRequest } from "@/lib/i18n/server-t";
import { currentUser } from "@/lib/auth/session";
import { getEntitlement, hasFeature, FEATURE_KEYS } from "@/lib/billing/entitlement";
import { listUserOrganizations, pendingOrgInvites } from "@/lib/workspaces";
import { Badge, EmptyState, PageHeader, StatCard } from "@/components/ui";
import {
  IconBuilding,
  IconChevronRight,
  IconArrowRight,
  IconShield,
  IconGitPullRequest,
} from "@/components/icons";
import { createOrganization } from "./actions";
import {
  AcceptInviteButton,
  DeclineInviteButton,
} from "@/components/dashboard/workspace-forms";

export const dynamic = "force-dynamic";

export default async function OrganizationsPage() {
  const { t } = await getTranslatorForRequest();
  const user = await currentUser();
  if (!user) return null;

  const [orgs, invites, entitlement] = await Promise.all([
    listUserOrganizations(user.id),
    pendingOrgInvites(user.login),
    getEntitlement(user.id),
  ]);
  const canUseOrgs =
    user.role === "admin" || hasFeature(entitlement, FEATURE_KEYS.organizationWorkspace);

  const totalMembers = orgs.reduce((n, o) => n + o.memberCount, 0);

  return (
    <div className="space-y-8">
      <PageHeader
        badge={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-500/30 bg-brand-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-brand-300">
            <IconBuilding className="h-3 w-3" />
            {t("organizations:eyebrow")}
          </span>
        }
        title={t("organizations:organizations")}
        description={t("organizations:description")}
        actions={
          canUseOrgs ? (
            <Link href="/dashboard/billing" className="btn btn-ghost btn-sm">
              <IconShield className="h-3.5 w-3.5" />
              <span>{t("organizations:manage_plan")}</span>
            </Link>
          ) : undefined
        }
      />

      {invites.length > 0 ? (
        <section className="overflow-hidden rounded-xl border border-brand-500/25 bg-ink-900/50 shadow-sm">
          <div className="flex items-center justify-between border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-brand-300">
              {t("organizations:invites_for_you")}
            </span>
          </div>
          <ul className="divide-y divide-white/[0.05]">
            {invites.map((inv) => (
              <li
                key={inv.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{inv.organization.name}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-ink-400">
                    {t("organizations:invited_by_as", {
                      login: inv.invitedBy.login,
                      role: t(`workspace:role_${inv.role}`),
                    })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <AcceptInviteButton
                    kind="organization"
                    workspaceId={inv.organizationId}
                    label={t("organizations:accept")}
                  />
                  <DeclineInviteButton kind="organization" workspaceId={inv.organizationId} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!canUseOrgs ? (
        <EmptyState
          icon={IconBuilding}
          title={t("organizations:orgs_require_plan")}
          hint={t("organizations:require_plan_hint")}
          action={
            <Link href="/dashboard/billing" className="btn btn-primary btn-sm">
              <span>{t("organizations:upgrade_to_org")}</span>
              <IconArrowRight className="h-3.5 w-3.5" />
            </Link>
          }
        />
      ) : (
        <>
          {/* Create organization */}
          <section className="rounded-xl border border-white/[0.08] bg-ink-900/60 p-5 shadow-sm">
            <h2 className="text-sm font-bold text-white">{t("organizations:create_org")}</h2>
            <p className="mb-4 mt-1 text-xs leading-relaxed text-ink-400">
              {t("organizations:create_org_hint")}
            </p>
            <form
              action={async (formData) => {
                "use server";
                await createOrganization({
                  name: String(formData.get("name") ?? ""),
                  slug: String(formData.get("slug") ?? ""),
                });
              }}
              className="flex flex-wrap items-end gap-2"
            >
              <div className="flex-1 min-w-52">
                <label htmlFor="org-name" className="mb-1 block text-[11px] font-semibold text-ink-400">
                  {t("workspace:name_label_org")}
                </label>
                <input
                  id="org-name"
                  name="name"
                  placeholder={t("organizations:name_placeholder")}
                  autoComplete="off"
                  className="input h-9 w-full text-sm"
                  required
                />
              </div>
              <div className="flex-1 min-w-40">
                <label htmlFor="org-slug" className="mb-1 block text-[11px] font-semibold text-ink-400">
                  {t("workspace:slug_label")}{" "}
                  <span className="text-ink-500">({t("organizations:optional")})</span>
                </label>
                <input
                  id="org-slug"
                  name="slug"
                  placeholder="acme-eng"
                  autoComplete="off"
                  spellCheck={false}
                  className="input h-9 w-full font-mono text-xs"
                />
              </div>
              <button type="submit" className="btn btn-primary btn-sm h-9">
                <span>{t("organizations:create_org_action")}</span>
                <IconChevronRight className="h-3.5 w-3.5" />
              </button>
            </form>
          </section>

          {orgs.length === 0 ? (
            <EmptyState
              icon={IconBuilding}
              title={t("organizations:no_orgs_yet")}
              hint={t("organizations:no_orgs_hint")}
            />
          ) : (
            <ul className="space-y-4">
              {orgs.map((org) => (
                <li
                  key={org.id}
                  className="rounded-xl border border-white/[0.08] bg-ink-900/60 p-5 shadow-sm transition-all duration-200 hover:border-white/[0.14]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <Link
                          href={`/dashboard/organization/${org.id}`}
                          className="truncate text-base font-bold text-white transition-colors hover:text-brand-300"
                        >
                          {org.name}
                        </Link>
                        <span className="rounded border border-white/[0.08] bg-ink-850 px-2 py-0.5 font-mono text-[10px] text-ink-400">
                          {org.slug}
                        </span>
                        <Badge tone={org.paid ? "success" : "warn"}>
                          {t(org.paid ? "workspace:owner_plan_active" : "workspace:owner_plan_inactive")}
                        </Badge>
                      </div>
                      <p className="mt-1 font-mono text-xs text-ink-400">
                        @{org.ownerLogin} &middot;{" "}
                        <span className="text-ink-200">{org.memberCount}</span>{" "}
                        {t("organizations:members_count", { count: org.memberCount })}
                        {org.role !== "member" ? (
                          <>
                            <span className="text-ink-600"> &middot; </span>
                            <span className="font-semibold text-brand-300">
                              {t(`workspace:role_${org.role}`)}
                            </span>
                          </>
                        ) : null}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {org.pendingInvites > 0 ? (
                        <span className="rounded-full border border-brand-500/25 bg-brand-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-brand-300">
                          {t("organizations:invites_pending", { count: org.pendingInvites })}
                        </span>
                      ) : null}
                      <Link
                        href={`/dashboard/organization/${org.id}/board`}
                        className="btn btn-ghost btn-sm"
                      >
                        <IconGitPullRequest className="h-3.5 w-3.5" />
                        <span>{t("workspace:tab_board")}</span>
                        <IconChevronRight className="h-3 w-3" />
                      </Link>
                      <Link href={`/dashboard/organization/${org.id}`} className="btn btn-ghost btn-sm">
                        <span>{t("organizations:manage")}</span>
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
              label={t("organizations:stat_your_orgs")}
              value={orgs.length}
              detail={t("organizations:stat_your_orgs_detail")}
              icon={IconBuilding}
            />
            <StatCard
              label={t("organizations:stat_members")}
              value={totalMembers}
              detail={t("organizations:stat_members_detail")}
              tone="brand"
              icon={IconBuilding}
            />
            <StatCard
              label={t("workspace:stat_pending_invites")}
              value={invites.length}
              detail={t(
                invites.length > 0
                  ? "organizations:stat_invites_detail_warn"
                  : "organizations:stat_invites_detail_clear",
              )}
              tone={invites.length > 0 ? "warn" : "default"}
              icon={IconGitPullRequest}
            />
          </section>
        </>
      )}
    </div>
  );
}