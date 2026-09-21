import Link from "next/link";

const links = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/faq", label: "FAQ" },
  { href: "/docs", label: "Docs" },
];

export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-ink-800/70 bg-ink-950/85 backdrop-blur">
      <div className="container-page flex h-14 items-center justify-between">
        <Link href="/" className="font-mono text-lg font-bold tracking-tight text-ink-50">
          baton
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-ink-200 sm:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="transition-colors hover:text-ink-50">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <Link href="/auth/login" className="text-sm text-ink-200 hover:text-ink-50">
            Sign in
          </Link>
          <Link href="/auth/login?next=/dashboard" className="btn-primary">
            Install Baton
          </Link>
        </div>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-ink-800/70">
      <div className="container-page flex flex-col items-center justify-between gap-4 py-10 text-sm text-ink-400 sm:flex-row">
        <div className="font-mono font-bold text-ink-100">baton</div>
        <nav className="flex flex-wrap items-center justify-center gap-6">
          <Link href="/pricing" className="hover:text-ink-100">Pricing</Link>
          <Link href="/faq" className="hover:text-ink-100">FAQ</Link>
          <Link href="/security" className="hover:text-ink-100">Security</Link>
          <Link href="/docs" className="hover:text-ink-100">Docs</Link>
          <Link href="/legal/privacy" className="hover:text-ink-100">Privacy</Link>
          <Link href="/legal/terms" className="hover:text-ink-100">Terms</Link>
        </nav>
        <p>© {new Date().getFullYear()} Baton Software Inc.</p>
      </div>
    </footer>
  );
}