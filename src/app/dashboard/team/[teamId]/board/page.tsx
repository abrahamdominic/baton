import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { listUserTeams, requireTeamMember, workspaceBoard } from "@/lib/workspaces";
import { PageHeader } from "@/components/ui";
import { IconUsers, IconGitPullRequest } from "@/components/icons";
import { WorkspaceBoard } from "@/components/dashboard/workspace-board";

export const dynamic = "force-dynamic";

export default async function TeamBoardPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  const user = await currentUser();
  if (!user) return null;

  const { role } = await requireTeamMember(teamId, user.id).catch(() => ({ role: "" as string }));
  if (!role) notFound();

  const [team, board] = await Promise.all([
    listUserTeams(user.id).then((ts) => ts.find((t) => t.id === teamId) ?? null),
    workspaceBoard("team", teamId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5 font-mono">
            <IconUsers className="h-3 w-3" />
            Team Workspace
          </span>
        }
        title={team ? team.name : "Team Board"}
        description="The board aggregates stalled pull requests from every GitHub account the team shares, so any member can pick work up."
        actions={
          <Link href={`/dashboard/team/${teamId}`} className="btn btn-ghost btn-sm">
            <IconGitPullRequest className="h-3.5 w-3.5" />
            <span>Manage team</span>
          </Link>
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