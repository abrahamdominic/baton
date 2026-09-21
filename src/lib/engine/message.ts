import { config } from "../env-boot";
import type { Classification } from "./types";
import { STATE_META } from "./types";

export interface StatusCommentContext {
  prUrl: string;
  repoBoardUrl: string;
  owner: string;
  repo: string;
  number: number;
  classification: Classification;
  stateDurationLabel: string;
  actorLabels: string[];
}

function formatDuration(hours: number): string {
  if (hours < 1) return "under an hour";
  if (hours < 24) return `${Math.floor(hours)}h`;
  const days = Math.floor(hours / 24);
  const rem = Math.round(hours % 24);
  if (days === 1) return "1 day" + (rem ? ` ${rem}h` : "");
  return `${days} days` + (rem ? ` ${rem}h` : "");
}

/**
 * Body of the live, always-up-to-date status comment Baton keeps on a PR.
 * The `<!-- baton-status -->` marker lets us find and update it in place.
 */
export function statusCommentBody(ctx: StatusCommentContext): string {
  const c = ctx.classification;
  const meta = STATE_META[c.state];
  const actors =
    ctx.actorLabels.length > 0 ? ctx.actorLabels.join(", ") : "No one yet";
  const lines: string[] = [
    `<!-- baton-status -->`,
    `## ${meta.label}`,
    ``,
    `**Whose turn:** ${actors}`,
    `**Blocked for:** ${ctx.stateDurationLabel}`,
    ``,
    ...c.reasons.map((r) => `- ${r}`),
    ``,
    `**${c.action}**`,
    ``,
    `<sub>Status by [Baton](${config.SITE_URL}) · [Repo board](${ctx.repoBoardUrl}) · #${ctx.number}</sub>`,
  ];
  return lines.join("\n");
}

/** Compact human label of how long a state has been active. */
export function durationFromHours(hours: number): string {
  return formatDuration(hours);
}