import { STATE_META, type BatonState, type StateMeta } from "@/lib/engine/types";

export function Badge({ tone, children }: { tone: StateMeta["tone"] | "neutral"; children: React.ReactNode }) {
  return <span className={`chip-${tone}`}>{children}</span>;
}

export function StateBadge({ state }: { state: string }) {
  const meta = STATE_META[state as BatonState];
  if (!meta) return <Badge tone="neutral">{state}</Badge>;
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export function Duration({ hours }: { hours: number }) {
  return <>{formatHours(hours)}</>;
}

function formatHours(hours: number): string {
  if (hours < 1) return "under an hour";
  if (hours < 24) return `${Math.max(0, Math.round(hours))}h`;
  const days = Math.floor(hours / 24);
  const rem = Math.round(hours % 24);
  if (days === 1) return rem ? `1d ${rem}h` : "1d";
  return rem ? `${days}d ${rem}h` : `${days}d`;
}

export function AccountHeader({
  login,
  avatarUrl,
  name,
}: {
  login: string;
  avatarUrl: string | null;
  name: string | null;
}) {
  return (
    <div className="flex items-center gap-2">
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt={login} width={24} height={24} className="rounded-full" />
      ) : null}
      <span className="text-sm text-ink-200">{name ?? login}</span>
      <a href="/auth/logout" className="text-xs text-ink-400 hover:text-ink-200">
        Sign out
      </a>
    </div>
  );
}

export function SignInButton({ className = "" }: { className?: string }) {
  return (
    <a href="/auth/login" className={`btn-primary ${className}`}>
      Sign in with GitHub
    </a>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-ink-800 border-dashed bg-transparent px-6 py-14 text-center">
      <p className="text-lg font-semibold text-ink-100">{title}</p>
      {hint ? <p className="max-w-md text-sm leading-relaxed text-ink-400">{hint}</p> : null}
    </div>
  );
}