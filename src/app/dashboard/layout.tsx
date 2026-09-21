import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { currentUser } from "@/lib/auth/session";
import { AccountHeader } from "@/components/ui";
import { Logo } from "@/components/marketing";

export const dynamic = "force-dynamic";

// Dashboard is a private product surface, never indexed.
export const metadata: Metadata = {
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
  title: "Dashboard: Baton",
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/auth/login?next=/dashboard");

  return (
    <div className="min-h-screen bg-ink-950 text-ink-100">
      <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-ink-950/85 backdrop-blur-md">
        <div className="container-page flex h-16 items-center justify-between gap-4">
          <div className="flex items-center gap-8">
            <Logo />
            <nav className="flex items-center gap-1.5 text-xs font-semibold">
              <Link
                href="/dashboard"
                className="rounded-lg px-3 py-1.5 text-white transition-colors hover:bg-white/[0.06]"
              >
                Your Move
              </Link>
              <Link
                href="/dashboard/repos"
                className="rounded-lg px-3 py-1.5 text-ink-300 transition-colors hover:bg-white/[0.06] hover:text-white"
              >
                Repositories
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/docs"
              className="hidden sm:inline-flex text-xs text-ink-400 hover:text-white transition-colors"
            >
              Docs
            </Link>
            <AccountHeader login={user.login} avatarUrl={user.avatarUrl} name={user.name} />
          </div>
        </div>
      </header>
      <main className="container-page py-10">{children}</main>
    </div>
  );
}