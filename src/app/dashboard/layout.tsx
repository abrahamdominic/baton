import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { currentUser } from "@/lib/auth/session";
import { AppShell } from "@/components/dashboard/app-shell";

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

  const githubUrl = `https://github.com/${encodeURIComponent(user.login)}`;

  return (
    <AppShell
      user={{
        login: user.login,
        name: user.name,
        avatarUrl: user.avatarUrl,
        githubUrl,
      }}
    >
      {children}
    </AppShell>
  );
}