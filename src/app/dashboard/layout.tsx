import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { currentUser } from "@/lib/auth/session";
import { AccountHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

// The individual dashboard is a private product surface — never indexed.
export const metadata: Metadata = {
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
  title: "Dashboard",
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/auth/login?next=/dashboard");

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-ink-800 bg-ink-950/90 backdrop-blur">
        <div className="container-page flex h-14 items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/dashboard" className="font-mono text-lg font-bold tracking-tight text-ink-50">
              baton
            </Link>
            <nav className="flex items-center gap-5 text-sm">
              <Link href="/dashboard" className="text-ink-200 hover:text-ink-50">
                Your Move
              </Link>
              <Link href="/dashboard/repos" className="text-ink-200 hover:text-ink-50">
                Repos
              </Link>
            </nav>
          </div>
          <AccountHeader login={user.login} avatarUrl={user.avatarUrl} name={user.name} />
        </div>
      </header>
      <main className="container-page py-8">{children}</main>
    </div>
  );
}