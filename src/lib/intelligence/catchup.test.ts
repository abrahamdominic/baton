import { describe, it, expect } from "vitest";
import { buildCatchUpBriefing, type CatchUpInput, type CatchUpSectionKey } from "./catchup";

/**
 * Personalized catch-up briefing (skill.md §9).
 *
 * Every timestamp is injected, so these tests never touch the system clock.
 * The theme is anti-spam: a briefing that repeats yesterday's backlog every
 * morning is worse than no briefing, so the window gate and the quiet flag are
 * the properties under test, not the prose.
 */

const NOW = new Date("2026-03-10T12:00:00Z");
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** A real Date, `ms` before NOW. Date arithmetic on a Date yields a number. */
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const REPOS = [{ id: "r1", owner: "acme", name: "widgets", fullName: "acme/widgets" }];

function input(over: Partial<CatchUpInput> = {}): CatchUpInput {
  return {
    login: "ada",
    since: ago(3 * DAY),
    now: NOW,
    repos: REPOS,
    pullRequests: [],
    revisions: [],
    previousRevisions: {},
    knowledge: [],
    unread: [],
    ...over,
  };
}

function pr(over: Partial<CatchUpInput["pullRequests"][number]> = {}) {
  return {
    repoId: "r1",
    number: 42,
    title: "Tighten the retry budget",
    url: "https://github.com/acme/widgets/pull/42",
    authorLogin: "grace",
    state: "awaiting_review",
    stateEnteredAt: ago(2 * HOUR),
    requestedReviewers: ["ada"],
    updatedAt: ago(2 * HOUR),
    ...over,
  };
}

const section = (b: ReturnType<typeof buildCatchUpBriefing>, key: CatchUpSectionKey) =>
  b.sections.find((s) => s.key === key)?.items ?? [];

describe("buildCatchUpBriefing — quiet is the default", () => {
  it("is quiet when literally nothing happened", () => {
    const b = buildCatchUpBriefing(input());
    expect(b.quiet).toBe(true);
    expect(b.total).toBe(0);
    expect(b.sections).toEqual([]);
  });

  it("stays quiet on a backlog that did not move inside the window", () => {
    // The single most important property: an old, still-open review request is
    // not news, and re-reporting it daily is the failure mode.
    const b = buildCatchUpBriefing(
      input({ pullRequests: [pr({ stateEnteredAt: ago(30 * DAY), updatedAt: ago(30 * DAY) })] }),
    );
    expect(b.quiet).toBe(true);
  });

  it("does not pad a quiet briefing with a section heading", () => {
    const b = buildCatchUpBriefing(input({ unread: [] }));
    expect(b.sections).toHaveLength(0);
  });

  it("echoes the window it used so the UI can say what it covers", () => {
    const since = ago(2 * DAY);
    expect(buildCatchUpBriefing(input({ since })).since).toEqual(since);
  });

  it("reports no window on a first briefing, rather than inventing one", () => {
    const b = buildCatchUpBriefing(input({ since: null, pullRequests: [pr()] }));
    expect(b.since).toBeNull();
    // Everything outstanding counts on a first run.
    expect(section(b, "waiting_on_you")).toHaveLength(1);
  });
});

describe("buildCatchUpBriefing — waiting on you", () => {
  it("surfaces a review requested from this person", () => {
    const b = buildCatchUpBriefing(input({ pullRequests: [pr()] }));
    const items = section(b, "waiting_on_you");
    expect(items).toHaveLength(1);
    expect(items[0]!.text).toContain("acme/widgets#42");
    expect(items[0]!.owner).toBe("you");
  });

  it("ignores a review requested from somebody else", () => {
    const b = buildCatchUpBriefing(input({ pullRequests: [pr({ requestedReviewers: ["grace"] })] }));
    expect(section(b, "waiting_on_you")).toHaveLength(0);
  });

  it("ignores the viewer's own pull request", () => {
    const b = buildCatchUpBriefing(
      input({ pullRequests: [pr({ authorLogin: "ada", requestedReviewers: ["ada"] })] }),
    );
    expect(section(b, "waiting_on_you")).toHaveLength(0);
  });

  it("matches the login case-insensitively, because GitHub logins are not", () => {
    const b = buildCatchUpBriefing(
      input({ login: "Ada", pullRequests: [pr({ authorLogin: "grace", requestedReviewers: ["ada"] })] }),
    );
    expect(section(b, "waiting_on_you")).toHaveLength(1);
  });

  it("uses the singular for a one-hour-old request", () => {
    const b = buildCatchUpBriefing(input({ pullRequests: [pr({ stateEnteredAt: ago(HOUR) })] }));
    expect(section(b, "waiting_on_you")[0]!.text).toContain("for 1 hour");
  });

  it("uses the plural once it is two hours old", () => {
    const b = buildCatchUpBriefing(input({ pullRequests: [pr({ stateEnteredAt: ago(5 * HOUR) })] }));
    expect(section(b, "waiting_on_you")[0]!.text).toContain("for 5 hours");
  });

  it("re-surfaces an old request that got a new comment", () => {
    const b = buildCatchUpBriefing(
      input({
        pullRequests: [pr({ stateEnteredAt: ago(20 * DAY), updatedAt: ago(HOUR) })],
      }),
    );
    expect(section(b, "waiting_on_you")).toHaveLength(1);
  });

  it("never lists the same pull request twice", () => {
    const b = buildCatchUpBriefing(input({ pullRequests: [pr(), pr()] }));
    expect(section(b, "waiting_on_you")).toHaveLength(1);
  });

  it("caps a section rather than rendering a wall of text", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      pr({ number: 100 + i, stateEnteredAt: ago(i * HOUR) }),
    );
    const b = buildCatchUpBriefing(input({ pullRequests: many }));
    expect(section(b, "waiting_on_you").length).toBeLessThanOrEqual(8);
  });

  it("keeps the newest first when it does cap", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      pr({ number: 100 + i, stateEnteredAt: ago(i * HOUR) }),
    );
    const items = section(buildCatchUpBriefing(input({ pullRequests: many })), "waiting_on_you");
    const times = items.map((i) => i.at.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });
});

describe("buildCatchUpBriefing — your own work", () => {
  it("flags unaddressed review feedback on the viewer's pull request", () => {
    const b = buildCatchUpBriefing(
      input({ pullRequests: [pr({ authorLogin: "ada", requestedReviewers: [], state: "changes_required" })] }),
    );
    expect(section(b, "your_work")[0]!.text).toContain("needs your changes");
  });

  it("explains conflicts differently from review feedback", () => {
    const b = buildCatchUpBriefing(
      input({ pullRequests: [pr({ authorLogin: "ada", requestedReviewers: [], state: "conflicts" })] }),
    );
    expect(section(b, "your_work")[0]!.text).toContain("merge conflicts");
  });

  it("does not claim somebody else's changes_required pull request as your work", () => {
    const b = buildCatchUpBriefing(
      input({ pullRequests: [pr({ authorLogin: "grace", requestedReviewers: [], state: "changes_required" })] }),
    );
    expect(section(b, "your_work")).toHaveLength(0);
  });
});

describe("buildCatchUpBriefing — failures and blockers", () => {
  it("attributes a CI failure to its author", () => {
    const b = buildCatchUpBriefing(
      input({ pullRequests: [pr({ state: "ci_failing", requestedReviewers: [] })] }),
    );
    expect(section(b, "ci_failures")[0]!.text).toContain("@grace");
  });

  it("marks somebody else's CI failure as theirs, not yours", () => {
    const b = buildCatchUpBriefing(
      input({ pullRequests: [pr({ state: "ci_failing", requestedReviewers: [] })] }),
    );
    expect(section(b, "ci_failures")[0]!.owner).toBe("team");
  });

  it("marks your own CI failure as yours", () => {
    const b = buildCatchUpBriefing(
      input({ pullRequests: [pr({ state: "ci_failing", authorLogin: "ada", requestedReviewers: [] })] }),
    );
    expect(section(b, "ci_failures")[0]!.owner).toBe("you");
  });

  it("reports an unclaimed blocked pull request as blocked", () => {
    const b = buildCatchUpBriefing(
      input({ pullRequests: [pr({ state: "blocked_on_checks", requestedReviewers: ["linus"] })] }),
    );
    expect(section(b, "blocked")[0]!.text).toContain("no reviewer has picked it up");
  });

  it("does not call a PR blocked when it is simply waiting on the viewer", () => {
    const b = buildCatchUpBriefing(input({ pullRequests: [pr({ state: "blocked_on_checks" })] }));
    expect(section(b, "blocked")).toHaveLength(0);
    expect(section(b, "waiting_on_you")).toHaveLength(0);
  });

  it("ignores a pull request from a repository the viewer cannot see", () => {
    const b = buildCatchUpBriefing(input({ pullRequests: [pr({ repoId: "r_other" })] }));
    expect(b.quiet).toBe(true);
  });
});

describe("buildCatchUpBriefing — repository memory", () => {
  const fact = (over: Partial<CatchUpInput["knowledge"][number]> = {}) => ({
    repoId: "r1",
    id: "k1",
    kind: "architecture",
    title: "Prisma owns the schema",
    revision: 3,
    lastChangedAt: ago(4 * HOUR),
    ...over,
  });

  it("reports a memory entry whose content changed", () => {
    const b = buildCatchUpBriefing(input({ knowledge: [fact()] }));
    expect(section(b, "knowledge")[0]!.text).toContain("Prisma owns the schema");
    expect(section(b, "knowledge")[0]!.href).toContain("tab=knowledge");
  });

  it("ignores a memory entry that last changed before the window", () => {
    const b = buildCatchUpBriefing(input({ knowledge: [fact({ lastChangedAt: ago(10 * DAY) })] }));
    expect(b.quiet).toBe(true);
  });

  it("marks a memory change as a system fact, not somebody's to-do", () => {
    const b = buildCatchUpBriefing(input({ knowledge: [fact()] }));
    expect(section(b, "knowledge")[0]!.owner).toBe("system");
  });
});

describe("buildCatchUpBriefing — collection revisions", () => {
  const rev = (revision: number, collectedAt = ago(HOUR)) => ({
    repoId: "r1",
    revision,
    collectedAt,
  });

  it("reports a repository whose facts advanced since the last briefing", () => {
    const b = buildCatchUpBriefing(input({ revisions: [rev(5)], previousRevisions: { r1: 4 } }));
    expect(section(b, "collaborators")).toHaveLength(1);
  });

  it("stays silent on a re-collection that changed nothing", () => {
    // The core anti-spam case: collectedAt is bumped on every scheduled sync,
    // so a time-only gate would ping the user on every run of the collector.
    const b = buildCatchUpBriefing(input({ revisions: [rev(5)], previousRevisions: { r1: 5 } }));
    expect(b.quiet).toBe(true);
  });

  it("stays silent on a re-collection that produced a lower revision", () => {
    const b = buildCatchUpBriefing(input({ revisions: [rev(3)], previousRevisions: { r1: 5 } }));
    expect(section(b, "collaborators")).toHaveLength(0);
  });

  it("reports the first sighting of a repository", () => {
    const b = buildCatchUpBriefing(input({ revisions: [rev(1)], previousRevisions: {} }));
    expect(section(b, "collaborators")).toHaveLength(1);
  });
});

describe("buildCatchUpBriefing — unread conversations", () => {
  it("summarises unread notifications as one line", () => {
    const b = buildCatchUpBriefing(
      input({
        unread: [
          { id: "n1", type: "review_requested", createdAt: ago(HOUR) },
          { id: "n2", type: "mention", createdAt: ago(3 * HOUR) },
        ],
      }),
    );
    const items = section(b, "conversations");
    expect(items).toHaveLength(1);
    expect(items[0]!.text).toContain("2 notifications");
  });

  it("uses the singular for exactly one unread notification", () => {
    const b = buildCatchUpBriefing(
      input({ unread: [{ id: "n1", type: "mention", createdAt: ago(HOUR) }] }),
    );
    expect(section(b, "conversations")[0]!.text).toContain("One notification");
  });

  it("says nothing about conversations when the inbox is empty", () => {
    const b = buildCatchUpBriefing(input({ unread: [] }));
    expect(section(b, "conversations")).toHaveLength(0);
  });
});

describe("buildCatchUpBriefing — section order", () => {
  it("puts what is mine before what the system learned", () => {
    const b = buildCatchUpBriefing(
      input({
        pullRequests: [pr()],
        knowledge: [
          { repoId: "r1", id: "k1", kind: "architecture", title: "Fact", revision: 1, lastChangedAt: ago(HOUR) },
        ],
        revisions: [{ repoId: "r1", revision: 9, collectedAt: ago(HOUR) }],
        previousRevisions: { r1: 1 },
      }),
    );
    expect(b.sections.map((s) => s.key)).toEqual(["waiting_on_you", "knowledge", "collaborators"]);
  });

  it("counts every item across sections", () => {
    const b = buildCatchUpBriefing(
      input({
        pullRequests: [pr(), pr({ number: 43, authorLogin: "ada", state: "changes_required", requestedReviewers: [] })],
        unread: [{ id: "n1", type: "mention", createdAt: ago(HOUR) }],
      }),
    );
    expect(b.total).toBe(b.sections.reduce((n, s) => n + s.items.length, 0));
    expect(b.total).toBe(3);
  });
});
