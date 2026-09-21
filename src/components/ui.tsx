import { STATE_META, type BatonState, type StateMeta } from "@/lib/engine/types";
import { IconCheckCircle } from "@/components/icons";

export function Badge({
  tone,
  children,
}: {
  tone: StateMeta["tone"] | "neutral";
  children: React.ReactNode;
}) {
  const dotColor =
    tone === "warn"
      ? "bg-warn-400"
      : tone === "danger"
      ? "bg-danger-400"
      : tone === "success"
      ? "bg-signal-400"
      : tone === "info"
      ? "bg-brand-400"
      : "bg-ink-400";

  return (
    <span className={`chip-${tone} inline-flex items-center gap-1.5`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
      <span>{children}</span>
    </span>
  );
}

export function StateBadge({ state }: { state: string }) {
  const meta = STATE_META[state as BatonState];
  if (!meta) return <Badge tone="neutral">{state}</Badge>;
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export function Duration({ hours }: { hours: number }) {
  return <span className="font-mono">{formatHours(hours)}</span>;
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
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-ink-900/80 px-2.5 py-1">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt={login}
            width={20}
            height={20}
            className="rounded-full ring-1 ring-white/20"
          />
        ) : null}
        <span className="text-xs font-semibold text-white">{name ?? login}</span>
      </div>
      <a
        href="/auth/logout"
        className="rounded-md border border-white/[0.08] bg-ink-900/60 px-2.5 py-1 text-xs text-ink-400 transition-colors hover:border-white/[0.14] hover:text-white"
      >
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
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/[0.08] border-dashed bg-ink-900/20 px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/[0.08] bg-ink-900 text-signal-400">
        <IconCheckCircle className="h-6 w-6" />
      </div>
      <p className="text-base font-bold text-white">{title}</p>
      {hint ? <p className="max-w-md text-xs leading-relaxed text-ink-400">{hint}</p> : null}
    </div>
  );
}