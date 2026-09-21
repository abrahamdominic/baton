import Link from "next/link";
import { currentUser } from "@/lib/auth/session";
import { myInstallations } from "@/lib/queries/dashboard";
import { config } from "@/lib/env-boot";
import { setRepoEnabled, updateRepoSettings, rescanRepo } from "../actions";
import { Badge, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

const THRESHOLDS = [
  { key: "firstResponseHours" as const, label: "First response", hint: "Awaiting review, no reply yet" },
  { key: "reviewFollowUpHours" as const, label: "Re-review", hint: "Author pushed fixes" },
  { key: "changesRequiredHours" as const, label: "Changes required", hint: "Reviewer asked for changes" },
  { key: "ciFailHours" as const, label: "CI failing", hint: "A check is red" },
  { key: "conflictHours" as const, label: "Conflicts", hint: "Branch drift vs base" },
  { key: "readyToMergeHours" as const, label: "Ready to merge", hint: "Approved & green, not merged" },
];

export default async function ReposPage() {
  const user = await currentUser();
  const installations = await myInstallations(user!);
  const repos = installations.flatMap((i) => i.repos.map((r) => ({ ...r, account: i.accountLogin })));

  if (repos.length === 0) {
    return (
      <EmptyState
        title="No repositories yet"
        hint={`Install Baton on your repositories to start tracking PR states. Repos you install on appear here.`}
      />
    );
  }

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Repositories</h1>
          <p className="mt-1 text-sm text-ink-300">
            {repos.length} repo{repos.length === 1 ? "" : "s"} across {installations.length} account
            {installations.length === 1 ? "" : "s"}
          </p>
        </div>
        <a
          href={`https://github.com/apps/${config.GITHUB_APP_SLUG}/installations/new`}
          className="btn-ghost"
          target="_blank"
          rel="noreferrer"
        >
          Install on another repo
        </a>
      </section>

      <ul className="space-y-4">
        {repos
          .sort((a, b) => a.owner.localeCompare(b.owner) || a.name.localeCompare(b.name))
          .map((r) => (
            <li key={r.id} className="card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/dashboard/repos/${r.owner}/${r.name}`}
                      className="truncate font-semibold text-ink-50 hover:text-brand-300"
                    >
                      {r.owner}/{r.name}
                    </Link>
                    <Badge tone={r.enabled ? "success" : "neutral"}>
                      {r.enabled ? "tracking" : "paused"}
                    </Badge>
                    {r.isPrivate ? <Badge tone="neutral">private</Badge> : null}
                  </div>
                  <p className="mt-0.5 text-xs text-ink-400">
                    {r.account} · default branch {r.defaultBranch}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <form action={async () => { "use server"; await setRepoEnabled(r.id, !r.enabled); }}>
                    <button type="submit" className="btn-ghost text-xs">
                      {r.enabled ? "Pause" : "Resume"}
                    </button>
                  </form>
                  <form action={async () => { "use server"; await rescanRepo(r.name); }}>
                    <button type="submit" className="btn-ghost text-xs">
                      Re-scan
                    </button>
                  </form>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {r.setting
                  ? THRESHOLDS.map((t) => (
                      <label key={t.key} className="flex items-center justify-between gap-3 text-sm">
                        <span className="min-w-0">
                          <span className="block font-medium text-ink-100">{t.label}</span>
                          <span className="block text-xs text-ink-400">{t.hint}</span>
                        </span>
                        <span className="flex items-center gap-1">
                          <input
                            name={t.key}
                            form={`settings-${r.id}`}
                            defaultValue={r.setting?.[t.key] ?? 24}
                            type="number"
                            min={1}
                            max={720}
                            className="input w-20 text-right"
                          />
                          <span className="text-xs text-ink-400">h</span>
                        </span>
                      </label>
                    ))
                  : null}
              </div>

              <form
                id={`settings-${r.id}`}
                action={async (formData) => {
                  "use server";
                  const int = (k: string) => Number(formData.get(k) ?? 24);
                  await updateRepoSettings({
                    repoId: r.id,
                    statusCommentEnabled: true,
                    labelsEnabled: true,
                    nudgesEnabled: true,
                    firstResponseHours: int("firstResponseHours"),
                    reviewFollowUpHours: int("reviewFollowUpHours"),
                    changesRequiredHours: int("changesRequiredHours"),
                    ciFailHours: int("ciFailHours"),
                    conflictHours: int("conflictHours"),
                    readyToMergeHours: int("readyToMergeHours"),
                    maxNudgesPerState: 1,
                  });
                }}
                className="mt-4 flex justify-end"
              >
                <button type="submit" className="btn-primary text-xs">
                  Save thresholds
                </button>
              </form>
            </li>
          ))}
      </ul>
    </div>
  );
}