import Link from "next/link";
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
            Organization Workspaces
          </span>
        }
        title="Organizations"
        description="Heads of engineering run organization-wide review stall policies and export a full audit trail, while members share a single board."
        actions={
          canUseOrgs ? (
            <Link href="/dashboard/billing" className="btn btn-ghost btn-sm">
              <IconShield className="h-3.5 w-3.5" />
              <span>Manage plan</span>
            </Link>
          ) : undefined
        }
      />

      {invites.length > 0 ? (
        <section className="overflow-hidden rounded-xl border border-brand-500/25 bg-ink-900/50 shadow-sm">
          <div className="flex items-center justify-between border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-brand-300">
              Organization invitations for you
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
                    Invited by @{inv.invitedBy.login} as {inv.role}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <AcceptInviteButton
                    kind="organization"
                    workspaceId={inv.organizationId}
                    label="Accept"
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
          title="Organization workspaces require the Organization plan"
          hint="Unlock organization-wide review stall policies, roles and invitations, shared boards, and an exportable audit trail."
          action={
            <Link href="/dashboard/billing" className="btn btn-primary btn-sm">
              <span>Upgrade to Organization</span>
              <IconArrowRight className="h-3.5 w-3.5" />
            </Link>
          }
        />
      ) : (
        <>
          {/* Create organization */}
          <section className="rounded-xl border border-white/[0.08] bg-ink-900/60 p-5 shadow-sm">
            <h2 className="text-sm font-bold text-white">Create an organization</h2>
            <p className="mb-4 mt-1 text-xs leading-relaxed text-ink-400">
              Organization owners set stall policies that apply across every shared repository, and
              the audit log records member, invite, policy, and installation changes.
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
                  Organization name
                </label>
                <input
                  id="org-name"
                  name="name"
                  placeholder="e.g. Acme Engineering"
                  autoComplete="off"
                  className="input h-9 w-full text-sm"
                  required
                />
              </div>
              <div className="flex-1 min-w-40">
                <label htmlFor="org-slug" className="mb-1 block text-[11px] font-semibold text-ink-400">
                  Slug <span className="text-ink-500">(optional)</span>
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
                <span>Create organization</span>
                <IconChevronRight className="h-3.5 w-3.5" />
              </button>
            </form>
          </section>

          {orgs.length === 0 ? (
            <EmptyState
              icon={IconBuilding}
              title="No organizations yet"
              hint="Create your first organization above to set org-wide policies and share boards with your engineering team."
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
                          {org.paid ? "owner plan active" : "owner plan inactive"}
                        </Badge>
                      </div>
                      <p className="mt-1 font-mono text-xs text-ink-400">
                        @{org.ownerLogin} &middot; <span className="text-ink-200">{org.memberCount}</span>{" "}
                        member{org.memberCount === 1 ? "" : "s"}
                        {org.role !== "member" ? (
                          <>
                            <span className="text-ink-600"> &middot; </span>
                            <span className="font-semibold text-brand-300">{org.role}</span>
                          </>
                        ) : null}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {org.pendingInvites > 0 ? (
                        <span className="rounded-full border border-brand-500/25 bg-brand-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-brand-300">
                          {org.pendingInvites} invite{org.pendingInvites === 1 ? "" : "s"} pending
                        </span>
                      ) : null}
                      <Link
                        href={`/dashboard/organization/${org.id}/board`}
                        className="btn btn-ghost btn-sm"
                      >
                        <IconGitPullRequest className="h-3.5 w-3.5" />
                        <span>Board</span>
                        <IconChevronRight className="h-3 w-3" />
                      </Link>
                      <Link href={`/dashboard/organization/${org.id}`} className="btn btn-ghost btn-sm">
                        <span>Manage</span>
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
              label="Your Organizations"
              value={orgs.length}
              detail="Across your memberships"
              icon={IconBuilding}
            />
            <StatCard
              label="Organization Members"
              value={totalMembers}
              detail="Total across your orgs"
              tone="brand"
              icon={IconBuilding}
            />
            <StatCard
              label="Pending Invites"
              value={invites.length}
              detail={invites.length > 0 ? "Awaiting your decision" : "Nothing to review"}
              tone={invites.length > 0 ? "warn" : "default"}
              icon={IconGitPullRequest}
            />
          </section>
        </>
      )}
    </div>
  );
}