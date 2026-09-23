import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { currentUser } from "@/lib/auth/session";
import { AppShell } from "@/components/dashboard/app-shell";
import { pendingTeamInvites, pendingOrgInvites } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

// Dashboard is a private product surface, never indexed. Child pages inherit
// this along with the X-Robots-Tag header applied in next.config.ts.
export const metadata: Metadata = {
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
  title: "Dashboard: Baton",
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/auth/login?next=/dashboard");

  if (user.suspendedAt) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="text-2xl font-bold text-white">Account suspended</h1>
        <p className="text-sm leading-relaxed text-ink-400">
          Your Baton account has been suspended. If you believe this is a mistake, contact support
          at <a href="mailto:support@baton.dev" className="text-brand-300">support@baton.dev</a>.
        </p>
        <a href="/auth/logout" className="btn btn-ghost btn-sm">Sign out</a>
      </main>
    );
  }

  const githubUrl = `https://github.com/${encodeURIComponent(user.login)}`;

  const [teamInvites, orgInvites] = await Promise.all([
    pendingTeamInvites(user.login),
    pendingOrgInvites(user.login),
  ]).catch(() => [[], []] as const);

  return (
    <AppShell
      user={{
        login: user.login,
        name: user.name,
        avatarUrl: user.avatarUrl,
        githubUrl,
        role: user.role,
      }}
      pendingInvites={{ team: teamInvites.length, organization: orgInvites.length }}
    >
      {children}
    </AppShell>
  );
}