import Link from "next/link";
import { currentUser, readSessionCookie, hashToken } from "@/lib/auth/session";
import { myInstallations, userSessions } from "@/lib/queries/dashboard";
import { config } from "@/lib/env-boot";
import { isAppConfigured, isGitHubConfigured } from "@/lib/config";
import { revokeSessionById, revokeOtherSessions } from "../actions";
import { Badge, PageHeader } from "@/components/ui";
import {
  IconBranch,
  IconExternalLink,
  IconGitHub,
  IconLogOut,
  IconShield,
  IconMonitor,
  IconSmartphone,
} from "@/components/icons";

export const dynamic = "force-dynamic";

function deviceLabel(userAgent: string | null): { label: string; isMobile: boolean } {
  if (!userAgent) return { label: "Unknown device", isMobile: false };
  let os = "Device";
  let isMobile = false;
  if (/windows/i.test(userAgent)) os = "Windows";
  else if (/mac os x|macintosh/i.test(userAgent)) os = "macOS";
  else if (/iphone|ipad|ipod/i.test(userAgent)) {
    os = "iOS";
    isMobile = true;
  } else if (/android/i.test(userAgent)) {
    os = "Android";
    isMobile = true;
  } else if (/linux/i.test(userAgent)) os = "Linux";

  let browser = "";
  if (/edg\//i.test(userAgent)) browser = "Edge";
  else if (/opr\//i.test(userAgent)) browser = "Opera";
  else if (/chrome|crios/i.test(userAgent)) browser = "Chrome";
  else if (/firefox|fxios/i.test(userAgent)) browser = "Firefox";
  else if (/safari/i.test(userAgent)) browser = "Safari";

  return { label: browser ? `${os} · ${browser}` : os, isMobile };
}

function sessionStarts(s: { createdAt: Date }): string {
  return s.createdAt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function SettingsPage() {
  const user = await currentUser();
  if (!user) return null;

  const [installations, sessions] = await Promise.all([
    myInstallations(user, { allRepos: true }),
    userSessions(user, hashToken((await readSessionCookie()) ?? "")),
  ]);

  const appConfigured = isAppConfigured(config);
  const oauthConfigured = isGitHubConfigured(config);
  const totalRepos = installations.reduce((n, i) => n + i.repos.length, 0);
  const githubUrl = `https://github.com/${encodeURIComponent(user.login)}`;
  const installUrl = `https://github.com/apps/${config.GITHUB_APP_SLUG}/installations/new`;

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <PageHeader
        eyebrow="Account &amp; Integrations"
        title="Settings &amp; Access"
        description="Manage your authenticated GitHub profile, connected repositories, and active browser sessions."
        actions={
          <a
            href={githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost btn-sm"
          >
            <IconGitHub className="h-3.5 w-3.5" />
            <span>GitHub Profile</span>
            <IconExternalLink className="h-3 w-3" />
          </a>
        }
      />

      {/* GitHub Identity Card */}
      <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm">
        <div className="border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
          <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
            GitHub Identity &amp; Profile
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
          <div className="flex items-center gap-4">
            {user.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.avatarUrl}
                alt={user.login}
                width={56}
                height={56}
                className="h-14 w-14 rounded-full ring-2 ring-white/10"
              />
            ) : (
              <span className="flex h-14 w-14 items-center justify-center rounded-full border border-white/[0.1] bg-ink-800 font-mono text-lg font-bold text-ink-200">
                {(user.name ?? user.login).slice(0, 1).toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate text-base font-bold text-white sm:text-lg">
                  {user.name ?? user.login}
                </p>
                {user.role === "admin" ? (
                  <span className="rounded bg-brand-500/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-brand-300 ring-1 ring-brand-500/30">
                    Admin
                  </span>
                ) : null}
              </div>
              <p className="font-mono text-xs text-ink-400">@{user.login}</p>
              {user.email ? (
                <p className="mt-0.5 truncate text-xs text-ink-400">{user.email}</p>
              ) : null}
              <p className="mt-0.5 font-mono text-[10px] text-ink-500">GitHub ID: {user.githubId}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="/auth/logout"
              className="btn btn-ghost btn-sm text-ink-400 hover:text-white"
            >
              <IconLogOut className="h-3.5 w-3.5" />
              <span>Sign out</span>
            </a>
          </div>
        </div>
      </section>

      {/* Service Status Row */}
      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-white/[0.08] bg-ink-900/60 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <IconGitHub className="h-4 w-4 text-ink-300" />
              <span className="text-xs font-bold text-white">GitHub OAuth Authentication</span>
            </div>
            <Badge tone={oauthConfigured ? "success" : "warn"}>
              {oauthConfigured ? "configured" : "unconfigured"}
            </Badge>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-ink-400">
            {oauthConfigured
              ? "OAuth client credentials are valid. You can safely sign in and authenticate with GitHub."
              : "OAuth credentials are not configured on this deployment. Sign-in is restricted."}
          </p>
        </div>

        <div className="rounded-xl border border-white/[0.08] bg-ink-900/60 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <IconShield className="h-4 w-4 text-ink-300" />
              <span className="text-xs font-bold text-white">Baton GitHub App Engine</span>
            </div>
            <Badge tone={appConfigured ? "success" : "neutral"}>
              {appConfigured ? "configured" : "unconfigured"}
            </Badge>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-ink-400">
            {appConfigured
              ? "The GitHub App webhook receiver and private key are active. Pull request sync is enabled."
              : "GitHub App private key is not configured. PR sync requires GITHUB_APP_ID & GITHUB_APP_PRIVATE_KEY."}
          </p>
        </div>
      </section>

      {/* Connected GitHub App Installations */}
      <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
          <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
            Connected GitHub App Installations ({installations.length}) &middot; {totalRepos} repos
          </span>
          <a
            href={installUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] font-semibold text-brand-300 transition-colors hover:text-brand-200"
          >
            + Install on another account
          </a>
        </div>

        {installations.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/[0.08] bg-ink-900 text-brand-300">
              <IconBranch className="h-6 w-6" />
            </div>
            <p className="text-sm font-bold text-white">No GitHub App installations connected</p>
            <p className="max-w-md text-xs leading-relaxed text-ink-400">
              Install the Baton GitHub App to track repositories and configure automated pull request
              nudges.
            </p>
            <a
              href={installUrl}
              target="_blank"
              rel="noreferrer"
              className="btn btn-primary btn-sm mt-2"
            >
              <IconGitHub className="h-3.5 w-3.5" />
              <span>Install on GitHub</span>
            </a>
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {installations.map((inst) => (
              <li key={inst.id} className="p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2.5">
                      <Link
                        href={`https://github.com/${encodeURIComponent(inst.accountLogin)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-sm font-bold text-white transition-colors hover:text-brand-300"
                      >
                        @{inst.accountLogin}
                      </Link>
                      <Badge tone={inst.accountType === "Organization" ? "info" : "neutral"}>
                        {inst.accountType === "Organization" ? "org" : "user"}
                      </Badge>
                    </div>
                    <p className="mt-0.5 font-mono text-[11px] text-ink-500">
                      Installation #{inst.installationId} &middot; {inst.repos.length} repositor
                      {inst.repos.length === 1 ? "y" : "ies"} selected
                    </p>
                  </div>

                  <a
                    href={`https://github.com/apps/${config.GITHUB_APP_SLUG}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-ghost btn-sm"
                  >
                    <span>Configure on GitHub</span>
                    <IconExternalLink className="h-3 w-3" />
                  </a>
                </div>

                {inst.repos.length > 0 ? (
                  <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {inst.repos.map((r) => (
                      <li key={r.id}>
                        <Link
                          href={`/dashboard/repos/${r.owner}/${r.name}`}
                          className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-ink-950/50 px-3 py-2 font-mono text-xs text-ink-300 transition-colors hover:border-white/[0.14] hover:text-white"
                        >
                          <span className="truncate">
                            {r.owner}/{r.name}
                          </span>
                          <Badge tone={r.enabled ? "success" : "neutral"}>
                            {r.enabled ? "tracking" : "paused"}
                          </Badge>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-xs text-ink-500">No repositories selected in this installation.</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Active Sessions */}
      <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/60 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] bg-ink-950/70 px-5 py-3">
          <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
            Active Sessions ({sessions.length})
          </span>
          {sessions.length > 1 ? (
            <form
              action={async () => {
                "use server";
                await revokeOtherSessions();
              }}
            >
              <button type="submit" className="btn btn-ghost btn-sm text-danger-300 hover:text-danger-200">
                Sign out of all other sessions
              </button>
            </form>
          ) : null}
        </div>

        {sessions.length === 0 ? (
          <p className="px-5 py-8 text-center text-xs text-ink-500">No active sessions found.</p>
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {sessions.map((s) => {
              const dev = deviceLabel(s.userAgent);
              return (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-white/[0.015]"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-ink-850 text-ink-300">
                      {dev.isMobile ? (
                        <IconSmartphone className="h-4 w-4" />
                      ) : (
                        <IconMonitor className="h-4 w-4" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-white">
                          {s.isCurrent ? "This browser session" : dev.label}
                        </span>
                        {s.isCurrent ? <Badge tone="info">current</Badge> : null}
                      </div>
                      <p className="mt-0.5 font-mono text-[11px] text-ink-500">
                        Started {sessionStarts(s)}
                        {s.ip && s.ip !== "unknown" ? ` · ${s.ip}` : ""}
                        {s.isCurrent ? "" : ` · last seen ${s.lastSeenAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
                      </p>
                    </div>
                  </div>

                  {s.isCurrent ? (
                    <a href="/auth/logout" className="btn btn-ghost btn-sm">
                      <IconLogOut className="h-3 w-3" />
                      <span>Sign out</span>
                    </a>
                  ) : (
                    <form
                      action={async () => {
                        "use server";
                        await revokeSessionById(s.id);
                      }}
                    >
                      <button
                        type="submit"
                        className="btn btn-ghost btn-sm text-ink-400 hover:border-danger-500/30 hover:text-danger-300"
                      >
                        Revoke
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}