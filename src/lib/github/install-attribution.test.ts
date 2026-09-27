import { describe, it, expect } from "vitest";
import { resolveInstallationAttribution } from "./install";
import { REPO_SETTING_DEFAULTS } from "../engine/thresholds";
import { STATE_META, BATON_LABELS, type BatonState } from "../engine/types";

/**
 * Regression cover for the Phase 7 audit findings.
 *
 * These are the rules that were previously implied by UI copy or by a permissive
 * code path, and could silently regress without any test failing.
 */

describe("installation attribution cannot be stolen", () => {
  it("creates the row when the installation is unknown", () => {
    expect(resolveInstallationAttribution(null, "user-a")).toBe("create");
  });

  it("adopts an installation that nobody owns yet", () => {
    expect(resolveInstallationAttribution({ userId: null }, "user-a")).toBe("adopt");
  });

  it("is a no-op when the caller already owns it", () => {
    expect(resolveInstallationAttribution({ userId: "user-a" }, "user-a")).toBe("keep");
  });

  it("refuses to reassign an installation owned by another user", () => {
    // installation_id is a sequential integer from a query string, so this is
    // the cross-tenant takeover guard.
    expect(resolveInstallationAttribution({ userId: "user-b" }, "user-a")).toBe("keep");
  });

  it("treats a missing row and an unowned row as different cases", () => {
    expect(resolveInstallationAttribution(undefined, "user-a")).toBe("create");
  });
});

describe("silent states advertise no GitHub label", () => {
  const LABELLED: BatonState[] = [
    "awaiting_review",
    "awaiting_review_after_fix",
    "changes_required",
    "ci_failing",
    "conflicts",
    "ready_to_merge",
  ];
  const SILENT: BatonState[] = ["draft", "blocked_on_checks", "merged", "closed"];

  it("has a label only for the states the engine actually labels", () => {
    for (const state of LABELLED) {
      expect(STATE_META[state].labelName).toMatch(/^baton:/);
    }
    for (const state of SILENT) {
      expect(STATE_META[state].labelName).toBe("");
    }
  });

  it("keeps BATON_LABELS free of empty entries", () => {
    expect(BATON_LABELS.every((l) => l.length > 0)).toBe(true);
    expect(BATON_LABELS).toHaveLength(LABELLED.length);
  });

  it("uses a unique label per state", () => {
    expect(new Set(BATON_LABELS).size).toBe(BATON_LABELS.length);
  });
});

describe("engine defaults are the single threshold source", () => {
  it("prices the annual discount off the built-in defaults", () => {
    expect(REPO_SETTING_DEFAULTS.firstResponseHours).toBe(24);
    expect(REPO_SETTING_DEFAULTS.reviewFollowUpHours).toBe(36);
    expect(REPO_SETTING_DEFAULTS.changesRequiredHours).toBe(72);
    expect(REPO_SETTING_DEFAULTS.ciFailHours).toBe(24);
    expect(REPO_SETTING_DEFAULTS.conflictHours).toBe(12);
    expect(REPO_SETTING_DEFAULTS.readyToMergeHours).toBe(48);
  });

  it("allows nudging by default", () => {
    expect(REPO_SETTING_DEFAULTS.maxNudgesPerState).toBe(1);
  });
});
