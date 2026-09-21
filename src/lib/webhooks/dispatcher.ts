import { logger } from "../logger";
import {
  enqueueInstallRegister,
  enqueueInstallUnregister,
  enqueuePrRefresh,
} from "../engine/jobs";
import { getAppId } from "../github/app";

export interface DispatchResult {
  registered: boolean;
  jobs: number;
  handled: string;
}

interface EventPayload {
  action?: string;
  installation?: { id: number } | null;
  repository?: { name?: string; full_name?: string; owner?: { login?: string } } | null;
  pull_request?: { number?: number } | null;
  check_run?: { pull_requests?: { number?: number }[] } | null;
  check_suite?: { pull_requests?: { number?: number }[] } | null;
  comment?: { user?: { type?: string } } | null;
  issue?: { pull_request?: unknown; number?: number } | null;
  sender?: { id?: number | string } | null;
}

function installationIdOf(payload: EventPayload): number | null {
  return payload.installation?.id ? Number(payload.installation.id) : null;
}

function prNumbersOfPr(payload: EventPayload): number[] {
  const n = payload.pull_request?.number;
  return typeof n === "number" ? [n] : [];
}

function repoOf(payload: EventPayload): { owner: string; repo: string } | null {
  const owner = payload.repository?.owner?.login ?? payload.repository?.full_name?.split("/")[0];
  const name = payload.repository?.name ?? payload.repository?.full_name?.split("/")[1];
  if (!owner || !name) return null;
  return { owner, repo: name };
}

/**
 * Map a raw webhook event to Baton work. Pure-ish decision layer; the route
 * performs the DB writes. Anything unrelated returns handled=false.
 */
export function dispatchEvent(
  eventType: string,
  payload: EventPayload,
): DispatchResult {
  const appId = getAppId();
  // Ignore events where *we* are the sender — prevents self-triggered loops.
  if (appId && payload.sender && String(payload.sender.id) === String(appId)) {
    return { registered: false, jobs: 0, handled: "self" };
  }

  switch (eventType) {
    case "installation": {
      const id = installationIdOf(payload);
      if (!id) return { registered: false, jobs: 0, handled: "installation.no-id" };
      if (payload.action === "created" || payload.action === "new_permissions_accepted") {
        void enqueueInstallRegister(id);
        return { registered: true, jobs: 1, handled: `installation.${payload.action}` };
      }
      if (payload.action === "deleted") {
        void enqueueInstallUnregister(id);
        return { registered: false, jobs: 1, handled: "installation.deleted" };
      }
      return { registered: false, jobs: 0, handled: "installation.ignore" };
    }

    case "installation_repositories":
    case "installation_repositories.added":
    case "installation_repositories.removed": {
      const id = installationIdOf(payload);
      if (id) void enqueueInstallRegister(id);
      return { registered: Boolean(id), jobs: 0, handled: eventType };
    }

    case "pull_request": {
      // opened, reopened, synchronize, ready_for_review, labeled, unlabeled,
      // converted_to_draft, edited, closed (merged or not) — a refresh handles all.
      const id = installationIdOf(payload);
      const repo = repoOf(payload);
      const numbers = prNumbersOfPr(payload);
      if (!id || !repo || numbers.length === 0) {
        return { registered: false, jobs: 0, handled: "pull_request.skip" };
      }
      for (const number of numbers) void enqueuePrRefresh(id, repo.owner, repo.repo, number);
      return { registered: false, jobs: numbers.length, handled: `pull_request.${payload.action ?? ""}` };
    }

    case "pull_request_review":
    case "pull_request_review_comment": {
      const id = installationIdOf(payload);
      const repo = repoOf(payload);
      const numbers = prNumbersOfPr(payload);
      if (!id || !repo || numbers.length === 0) {
        return { registered: false, jobs: 0, handled: "review.skip" };
      }
      for (const number of numbers) void enqueuePrRefresh(id, repo.owner, repo.repo, number);
      return { registered: false, jobs: numbers.length, handled: eventType };
    }

    case "pull_request_review_request": {
      const id = installationIdOf(payload);
      const repo = repoOf(payload);
      const numbers = prNumbersOfPr(payload);
      if (!id || !repo || numbers.length === 0) {
        return { registered: false, jobs: 0, handled: "review_request.skip" };
      }
      for (const number of numbers) void enqueuePrRefresh(id, repo.owner, repo.repo, number);
      return { registered: false, jobs: numbers.length, handled: "pull_request_review_request" };
    }

    case "check_run":
    case "check_suite": {
      // Only refresh PRs the check belongs to (usually 1). Covers CI transitions.
      const id = installationIdOf(payload);
      const repo = repoOf(payload);
      const numbers = (payload.check_run?.pull_requests ?? payload.check_suite?.pull_requests ?? [])
        .map((pr) => pr.number)
        .filter((n): n is number => typeof n === "number");
      if (!id || !repo || numbers.length === 0) {
        return { registered: false, jobs: 0, handled: "check.skip" };
      }
      for (const number of numbers.slice(0, 10)) {
        void enqueuePrRefresh(id, repo.owner, repo.repo, number);
      }
      return { registered: false, jobs: numbers.length, handled: eventType + ".completed" };
    }

    case "issue_comment": {
      // Skip comments by bots (incl. our own status/nudge comments) and issues,
      // not PRs. Author/comment activity can change "whose turn".
      const isBot = payload.comment?.user?.type === "Bot";
      const isPr = Boolean(payload.issue?.pull_request);
      const id = installationIdOf(payload);
      const repo = repoOf(payload);
      const number = payload.issue?.number;
      if (isBot || !isPr || !id || !repo || typeof number !== "number") {
        return { registered: false, jobs: 0, handled: "issue_comment.skip" };
      }
      void enqueuePrRefresh(id, repo.owner, repo.repo, number);
      return { registered: false, jobs: 1, handled: "issue_comment" };
    }

    default:
      logger.debug("webhook-event-ignored", { event: eventType, action: payload.action });
      return { registered: false, jobs: 0, handled: "ignored" };
  }
}

export function isEventTracked(eventType: string): boolean {
  return [
    "installation",
    "installation_repositories",
    "pull_request",
    "pull_request_review",
    "pull_request_review_comment",
    "pull_request_review_request",
    "check_run",
    "check_suite",
    "issue_comment",
  ].includes(eventType);
}