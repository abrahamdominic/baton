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
    <a href="/auth/login?next=/dashboard" className={`btn-primary ${className}`}>
      Sign in with GitHub
    </a>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  badge,
  actions,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 border-b border-white/[0.07] pb-6 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        {badge && !eyebrow ? (
          <div className="mb-2 flex items-center gap-2">{badge}</div>
        ) : eyebrow ? (
          <div className="mb-1 flex items-center gap-2">
            <span className="eyebrow">{eyebrow}</span>
            {badge ? <div className="ml-1">{badge}</div> : null}
          </div>
        ) : null}
        <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl lg:text-3xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 max-w-3xl text-xs leading-relaxed text-ink-300 sm:text-sm">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2.5 pt-1 sm:pt-0">
          {actions}
        </div>
      ) : null}
    </section>
  );
}

export function EmptyState({
  title,
  hint,
  icon: Icon = IconCheckCircle,
  action,
}: {
  title: string;
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3.5 rounded-xl border border-white/[0.08] bg-ink-900/40 px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/[0.1] bg-ink-850/80 text-ink-300 shadow-sm">
        <Icon className="h-6 w-6" />
      </div>
      <div className="max-w-md space-y-1.5">
        <p className="text-sm font-semibold text-white">{title}</p>
        {hint ? <p className="text-xs leading-relaxed text-ink-400">{hint}</p> : null}
      </div>
      {action ? <div className="mt-2 flex items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  detail,
  tone = "default",
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  detail?: string;
  tone?: "default" | "brand" | "signal" | "warn" | "danger";
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const valueColor =
    tone === "signal"
      ? "text-signal-400"
      : tone === "warn"
      ? "text-warn-400"
      : tone === "danger"
      ? "text-danger-400"
      : tone === "brand"
      ? "text-brand-300"
      : "text-white";

  const iconBg =
    tone === "signal"
      ? "border-signal-500/20 bg-signal-500/10 text-signal-400"
      : tone === "warn"
      ? "border-warn-500/20 bg-warn-500/10 text-warn-400"
      : tone === "danger"
      ? "border-danger-500/20 bg-danger-500/10 text-danger-400"
      : tone === "brand"
      ? "border-brand-500/20 bg-brand-500/10 text-brand-300"
      : "border-white/[0.08] bg-ink-850/80 text-ink-400";

  return (
    <div className="relative overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900/70 p-4 transition-all duration-200 hover:border-white/[0.14] sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-ink-400">{label}</p>
        {Icon ? (
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${iconBg}`}>
            <Icon className="h-4 w-4" />
          </span>
        ) : null}
      </div>
      <p className={`mt-2 font-mono text-2xl font-bold tabular-nums tracking-tight sm:text-3xl ${valueColor}`}>
        {value}
      </p>
      {detail ? (
        <p className="mt-1.5 truncate text-[11px] font-medium text-ink-400 sm:text-xs">
          {detail}
        </p>
      ) : null}
    </div>
  );
}