import { describe, it, expect } from "vitest";
import type { OrganizationPolicy, RepoSetting } from "@prisma/client";
import {
  REPO_SETTING_DEFAULTS,
  applyOrgPolicyToSetting,
  isRepoDefault,
} from "./thresholds";

function baseSetting(overrides: Partial<RepoSetting> = {}): RepoSetting {
  return {
    id: "rs_1",
    repoId: "repo_1",
    statusCommentEnabled: true,
    labelsEnabled: true,
    nudgesEnabled: true,
    firstResponseHours: 24,
    reviewFollowUpHours: 36,
    changesRequiredHours: 72,
    ciFailHours: 24,
    conflictHours: 12,
    readyToMergeHours: 48,
    maxNudgesPerState: 1,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function orgPolicy(overrides: Partial<OrganizationPolicy> = {}): OrganizationPolicy {
  return {
    id: "pol_1",
    organizationId: "org_1",
    firstResponseHours: 8,
    reviewFollowUpHours: 12,
    changesRequiredHours: 24,
    ciFailHours: 6,
    conflictHours: 4,
    readyToMergeHours: 12,
    maxNudgesPerState: 2,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

describe("Org-wide review policy vs per-repo thresholds", () => {
  it("applies the policy only to repo fields still at their built-in defaults", () => {
    const setting = applyOrgPolicyToSetting(baseSetting(), orgPolicy());
    expect(setting.firstResponseHours).toBe(8);
    expect(setting.changesRequiredHours).toBe(24);
    expect(setting.ciFailHours).toBe(6);
    expect(setting.maxNudgesPerState).toBe(2);
  });

  it("an individually customized repo keeps its own values (repo wins over policy)", () => {
    const customized = applyOrgPolicyToSetting(
      baseSetting({ firstResponseHours: 48, conflictHours: 72 }),
      orgPolicy({ firstResponseHours: 8, conflictHours: 4 }),
    );
    expect(customized.firstResponseHours).toBe(48);
    expect(customized.conflictHours).toBe(72);
    // Uncustomized fields still inherit the policy.
    expect(customized.ciFailHours).toBe(6);
  });

  it("no policy is a no-op", () => {
    const out = applyOrgPolicyToSetting(baseSetting({ firstResponseHours: 48 }), null);
    expect(out).toEqual(baseSetting({ firstResponseHours: 48 }));
  });

  it("a policy that matches the built-in defaults changes nothing", () => {
    const out = applyOrgPolicyToSetting(baseSetting(), orgPolicy(REPO_SETTING_DEFAULTS as Partial<OrganizationPolicy>));
    expect(out.firstResponseHours).toBe(24);
    expect(out.readyToMergeHours).toBe(48);
  });

  it("feature toggles and untouched fields survive the merge", () => {
    const out = applyOrgPolicyToSetting(
      baseSetting({ nudgesEnabled: false, statusCommentEnabled: false }),
      orgPolicy(),
    );
    expect(out.nudgesEnabled).toBe(false);
    expect(out.statusCommentEnabled).toBe(false);
  });

  it("isRepoDefault matches the schema defaults exactly", () => {
    const s = baseSetting();
    expect(isRepoDefault(s, "firstResponseHours")).toBe(true);
    expect(isRepoDefault(s, "maxNudgesPerState")).toBe(true);
    expect(isRepoDefault(baseSetting({ readyToMergeHours: 72 }), "readyToMergeHours")).toBe(false);
  });
});