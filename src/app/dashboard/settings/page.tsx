import Link from "next/link";
import { currentUser, readSessionCookie, hashToken } from "@/lib/auth/session";
import { myInstallations, userSessions } from "@/lib/queries/dashboard";
import { config } from "@/lib/env-boot";
import { isAppConfigured, isGitHubConfigured } from "@/lib/config";
import { revokeSessionById, revokeOtherSessions } from "../actions";
import { Badge } from "@/components/ui";
import {
  IconBranch,
  IconExternalLink,
  IconGitHub,
  IconLogOut,
  IconShield,
} from "@/components/icons";

export const dynamic = "force-dynamic";

function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  let os = "Device";
  if (/windows/i.test(userAgent)) os = "Windows";
  else if (/mac os x|macintosh/i.test(userAgent)) os = "macOS";
  else if (/iphone|ipad|ipod/i.test(userAgent)) os = "iOS";
  else if (/android/i.test(userAgent)) os = "Android";
  else if (/linux/i.test(userAgent)) os = "Linux";
  let browser = "";
  if (/edg\//i.test(userAgent)) browser = "Edge";
  else if (/opr\//i.test(userAgent)) browser = "Opera";
  else if (/chrome|crios/i.test(userAgent)) browser = "Chrome";
  else if (/firefox|fxios/i.test(userAgent)) browser = "Firefox";
  else if (/safari/i.test(userAgent)) browser = "Safari";
  return browser ? `${os} · ${browser}` : os;
}

function sessionStarts(s: { createdAt: Date }): string {
  return s.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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
  const repoCount = installations.reduce((n, i) => n + i.repos.length, 0);
  const githubUrl = `https://github.com/${encodeURIComponent(user.login)}`;

  return (
    <div className="space-y-8">
      <section>
        <p className="eyebrow">Account &amp; App Admin</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">Settings</h1>
        <p className="mt-1 text-xs text-ink-400">
          Your GitHub identity, connected GitHub App installations, and active sessions.
        </p>
      </section>

      {/* GitHub identity */}
      <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-ink-900/60">
        <div className="border-b border-white/[0.08] bg-ink-950/70 px-6 py-4">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-400">
            GitHub identity
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-4 p-6">
          {user.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.avatarUrl}
              alt={user.login}
              width={56}
              height={56}
              className="h-14 w-14 rounded-full ring-2 ring-white/15"
            />
          ) : (
            <span className="flex h-14 w-14 items-center justify-center rounded-full border border-white/[0.1] bg-ink-800 font-mono text-lg font-bold text-ink-200">
              {(user.name ?? user.login).slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-bold text-white">{user.name ?? user.login}</p>
            <p className="truncate font-mono text-xs text-ink-400">@{user.login}</p>
            {user.email ? <p className="mt-0.5 truncate text-xs text-ink-400">{user.email}</p> : null}
            <p className="mt-0.5 font-mono text-[11px] text-ink-600">GitHub ID: {user.githubId}</p>
          </div>
          <a
            href={githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost btn-sm"
          >
            View GitHub profile
            <IconExternalLink className="h-3 w-3" />
          </a>
        </div>
      </section>

      {/* Service status */}
      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-white/[0.08] bg-ink-900/60 p-5">
          <div className="flex items-center gap-2">
            <IconGitHub className="h-4 w-4 text-ink-300" />
            <span className="text-xs font-bold text-white">GitHub sign-in</span>
          </div>
          <p className="mt-2 text-xs text-ink-400">
            {oauthConfigured
              ? "OAuth credentials are configured; sign-in is enabled."
              : "OAuth credentials are not configured on this deployment; sign-in is unavailable."}
          </p>
          <span className="mt-3 inline-flex">
            <Badge tone={oauthConfigured ? "success" : "warn"}>
              {oauthConfigured ? "configured" : "not configured"}
            </Badge>
          </span>
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-ink-900/60 p-5">
          <div className="flex items-center gap-2">
            <IconShield className="h-4 w-4 text-ink-300" />
            <span className="text-xs font-bold text-white">Baton GitHub App</span>
          </div>
          <p className="mt-2 text-xs text-ink-400">
            {appConfigured
              ? "The GitHub App is configured; repository tracking is enabled."
              : "The GitHub App is not configured on this deployment, so no repositories or PR data will appear. OAuth sign-in works independently of it."}
          </p>
          <span className="mt-3 inline-flex">
            <Badge tone={appConfigured ? "success" : "neutral"}>
              {appConfigured ? "configured" : "not configured"}
            </Badge>
          </span>
        </div>
      </section>

      {/* Installations */}
      <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-ink-900/60">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] bg-ink-950/70 px-6 py-4">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-400">
            GitHub App installations
          </span>
          <a
            href={`https://github.com/apps/${config.GITHUB_APP_SLUG}/installations/new`}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] font-semibold text-brand-300 transition-colors hover:text-brand-200"
          >
            + Install on another account
          </a>
        </div>

        {installations.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.08] bg-ink-900 text-brand-300">
              <IconBranch className="h-5 w-5" />
            </div>
            <p className="text-sm font-bold text-white">No GitHub App installations connected</p>
            <p className="max-w-md text-xs leading-relaxed text-ink-400">
              {appConfigured
                ? "Install the Baton GitHub App on the accounts and repositories you want to track. Connect at least one installation to see PR data here."
                : "The Baton GitHub App is not configured on this deployment, so installation management is inactive here. Sign-in via OAuth still works — add GITHUB_APP_ID and a private key to enable repository tracking."}
            </p>
            <a
              href={`https://github.com/apps/${config.GITHUB_APP_SLUG}/installations/new`}
              target="_blank"
              rel="noreferrer"
              className="btn btn-primary btn-sm"
            >
              Install on GitHub
              <IconExternalLink className="h-3 w-3" />
            </a>
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {installations.map((inst) => (
              <li key={inst.id} className="p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2.5">
                      <Link
                        href={`https://github.com/${encodeURIComponent(inst.accountLogin)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="truncate font-mono text-sm font-bold text-white transition-colors hover:text-brand-300"
                      >
                        @{inst.accountLogin}
                      </Link>
                      <Badge tone={inst.accountType === "Organization" ? "info" : "neutral"}>
                        {inst.accountType === "Organization" ? "organization" : "user"}
                      </Badge>
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-ink-500">
                      Installation #{inst.installationId} · {inst.repos.length} repo
                      {inst.repos.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <Link
                    href={`https://github.com/apps/${config.GITHUB_APP_SLUG}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-ghost btn-sm"
                  >
                    Manage on GitHub
                    <IconExternalLink className="h-3 w-3" />
                  </Link>
                </div>

                {inst.repos.length > 0 ? (
                  <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                    {inst.repos.map((r) => (
                      <li key={r.id}>
                        <Link
                          href={`/dashboard/repos/${r.owner}/${r.name}`}
                          className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-ink-950/50 px-3 py-2 font-mono text-xs text-ink-300 transition-colors hover:border-white/[0.12] hover:text-white"
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

      {/* Active sessions */}
      <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-ink-900/60">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] bg-ink-950/70 px-6 py-4">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-400">
            Active sessions ({sessions.length})
          </span>
          {sessions.length > 1 ? (
            <form
              action={async () => {
                "use server";
                await revokeOtherSessions();
              }}
            >
              <button type="submit" className="btn btn-ghost btn-sm">
                Sign out of all other sessions
              </button>
            </form>
          ) : null}
        </div>

        {sessions.length === 0 ? (
          <p className="px-6 py-8 text-center text-xs text-ink-500">No active sessions.</p>
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {sessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-white">
                      {s.isCurrent ? "This browser" : deviceLabel(s.userAgent)}
                    </span>
                    {s.isCurrent ? <Badge tone="info">current</Badge> : null}
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-ink-500">
                    Signed in {sessionStarts(s)}
                    {s.ip && s.ip !== "unknown" ? ` · ${s.ip}` : ""}
                    {s.isCurrent ? "" : ` · last seen ${s.lastSeenAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
                  </p>
                </div>
                {s.isCurrent ? (
                  <a href="/auth/logout" className="btn btn-ghost btn-sm">
                    <IconLogOut className="h-3 w-3" />
                    Sign out
                  </a>
                ) : (
                  <form
                    action={async () => {
                      "use server";
                      await revokeSessionById(s.id);
                    }}
                  >
                    <button type="submit" className="btn btn-ghost btn-sm">
                      Revoke
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Account / stats summary */}
      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-white/[0.08] bg-ink-900/60 p-5">
          <p className="font-mono text-2xl font-extrabold tabular-nums text-white">{installations.length}</p>
          <p className="mt-1 text-xs text-ink-400">Installed account{installations.length === 1 ? "" : "s"}</p>
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-ink-900/60 p-5">
          <p className="font-mono text-2xl font-extrabold tabular-nums text-white">{repoCount}</p>
          <p className="mt-1 text-xs text-ink-400">Connected repositor{repoCount === 1 ? "y" : "ies"}</p>
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-ink-900/60 p-5">
          <p className="font-mono text-2xl font-extrabold tabular-nums text-white">{sessions.length}</p>
          <p className="mt-1 text-xs text-ink-400">Active session{sessions.length === 1 ? "" : "s"}</p>
        </div>
      </section>
    </div>
  );
}