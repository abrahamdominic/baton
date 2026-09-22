import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { AdminShell } from "@/components/admin/admin-shell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "Admin: Baton",
};

/**
 * Admin area guard. Only users explicitly granted the admin role (bootstrap
 * via BATON_ADMIN_LOGINS at sign-in, then managed in /admin/users) reach any
 * /admin page. Suspended admins are barred too.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/auth/login?next=/admin");
  if (user.role !== "admin" || user.suspendedAt) redirect("/dashboard");

  const githubUrl = `https://github.com/${encodeURIComponent(user.login)}`;
  return (
    <AdminShell
      admin={{
        login: user.login,
        name: user.name,
        avatarUrl: user.avatarUrl,
        githubUrl,
      }}
    >
      {children}
    </AdminShell>
  );
}