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
  { key: "ciFailHours" as const, label: "CI failing", hint: "A check suite is red" },
  { key: "conflictHours" as const, label: "Conflicts", hint: "Branch drift vs base" },
  { key: "readyToMergeHours" as const, label: "Ready to merge", hint: "Approved & green, not merged" },
];

export default async function ReposPage() {
  const user = await currentUser();
  if (!user) return null;
  const installations = await myInstallations(user);
  const repos = installations.flatMap((i) => i.repos.map((r) => ({ ...r, account: i.accountLogin })));

  if (repos.length === 0) {
    return (
      <EmptyState
        title="No repositories configured"
        hint="Install Baton on your GitHub repositories to start tracking pull requests. Tracked repositories will appear here."
      />
    );
  }

  return (
    <div className="space-y-10">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Settings &amp; Thresholds</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Tracked Repositories
          </h1>
          <p className="mt-1 text-xs text-ink-400">
            {repos.length} repository{repos.length === 1 ? "" : "ies"} connected across {installations.length} account
            {installations.length === 1 ? "" : "s"}
          </p>
        </div>
        <a
          href={`https://github.com/apps/${config.GITHUB_APP_SLUG}/installations/new`}
          className="btn btn-ghost btn-sm"
          target="_blank"
          rel="noreferrer"
        >
          + Add Repositories
        </a>
      </section>

      <ul className="space-y-6">
        {repos
          .sort((a, b) => a.owner.localeCompare(b.owner) || a.name.localeCompare(b.name))
          .map((r) => (
            <li key={r.id} className="card p-6">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.08] pb-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <Link
                      href={`/dashboard/repos/${r.owner}/${r.name}`}
                      className="truncate font-bold text-base text-white transition-colors hover:text-brand-300 font-mono"
                    >
                      {r.owner}/{r.name}
                    </Link>
                    <Badge tone={r.enabled ? "success" : "neutral"}>
                      {r.enabled ? "tracking" : "paused"}
                    </Badge>
                    {r.isPrivate ? <Badge tone="neutral">private</Badge> : null}
                  </div>
                  <p className="mt-1 text-xs text-ink-400 font-mono">
                    Account: @{r.account} · default branch: {r.defaultBranch}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <form action={async () => { "use server"; await setRepoEnabled(r.id, !r.enabled); }}>
                    <button type="submit" className="btn btn-ghost btn-sm">
                      {r.enabled ? "Pause Tracking" : "Resume"}
                    </button>
                  </form>
                  <form action={async () => { "use server"; await rescanRepo(`${r.owner}/${r.name}`); }}>
                    <button type="submit" className="btn btn-ghost btn-sm">
                      Re-scan Now
                    </button>
                  </form>
                </div>
              </div>

              <div className="mt-5">
                <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-400 block mb-3">
                  Nudge Thresholds (Grace period before polite mention):
                </span>
                <div className="grid gap-x-6 gap-y-3 rounded-xl border border-white/[0.06] bg-ink-950/60 p-4 sm:grid-cols-2 lg:grid-cols-3">
                  {r.setting
                    ? THRESHOLDS.map((t) => (
                        <label key={t.key} className="flex items-center justify-between gap-3 text-xs">
                          <span className="min-w-0">
                            <span className="block font-semibold text-white">{t.label}</span>
                            <span className="block text-[11px] text-ink-500">{t.hint}</span>
                          </span>
                          <span className="flex items-center gap-1.5">
                            <input
                              name={t.key}
                              form={`settings-${r.id}`}
                              defaultValue={r.setting?.[t.key] ?? 24}
                              type="number"
                              min={1}
                              max={720}
                              className="input w-16 text-right font-mono text-xs"
                            />
                            <span className="text-xs text-ink-400 font-mono">h</span>
                          </span>
                        </label>
                      ))
                    : null}
                </div>
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
                <button type="submit" className="btn btn-primary btn-sm">
                  Save Thresholds
                </button>
              </form>
            </li>
          ))}
      </ul>
    </div>
  );
}