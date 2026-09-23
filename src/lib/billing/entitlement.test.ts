import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { SubscriptionRecord, PlanRecord, Entitlement } from "./types";
import { FEATURE_KEYS } from "./types";
import { DEFAULT_PLANS } from "./plans";
import {
  entitlementFromSubscription,
  freeEntitlement,
  hasFeature,
  mergeEntitlements,
  FREE_PLAN_LIMITS,
} from "./entitlement";

function planOf(slug: string): PlanRecord {
  const p = DEFAULT_PLANS.find((x) => x.slug === slug);
  if (!p) throw new Error(`fixture plan missing: ${slug}`);
  return p;
}

function sub(plan: PlanRecord, status: SubscriptionRecord["status"] = "active"): SubscriptionRecord {
  return {
    id: "sub_1",
    user_id: "u_1",
    plan_id: plan.id,
    status,
    payment_provider: "stripe",
    provider_customer_id: null,
    provider_subscription_id: null,
    current_period_start: "2026-01-01T00:00:00.000Z",
    current_period_end: "2026-12-01T00:00:00.000Z",
    cancel_at_period_end: false,
    canceled_at: null,
    started_at: "2026-01-01T00:00:00.000Z",
    ended_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    plan,
  };
}

function free(): Entitlement {
  return freeEntitlement(null);
}

describe("entitlement gating: Team vs Organization", () => {
  it("free tier grants no paid features and a 3-repo cap", () => {
    const e = free();
    expect(e.hasPaidAccess).toBe(false);
    expect(e.planSlug).toBe("free");
    expect(e.maxRepos).toBe(FREE_PLAN_LIMITS.maxRepos);
    expect(e.maxMembers).toBe(0);
    for (const key of Object.values(FEATURE_KEYS)) {
      expect(hasFeature(e, key), key).toBe(false);
    }
  });

  it("resolves nothing for a null subscription", () => {
    expect(entitlementFromSubscription(null, "own")).toBeNull();
  });

  it("Team grants team workspace but none of the Organization-exclusive features", () => {
    const e = entitlementFromSubscription(sub(planOf("team")), "own")!;
    expect(e).not.toBeNull();
    expect(e.planSlug).toBe("team");
    expect(e.hasPaidAccess).toBe(true);
    expect(e.maxMembers).toBe(25);
    expect(hasFeature(e, FEATURE_KEYS.teamWorkspace)).toBe(true);
    expect(hasFeature(e, FEATURE_KEYS.customThresholds)).toBe(true);
    expect(hasFeature(e, FEATURE_KEYS.unlimitedRepos)).toBe(true);
    // Org-exclusive gates stay OFF for Team.
    expect(hasFeature(e, FEATURE_KEYS.organizationWorkspace)).toBe(false);
    expect(hasFeature(e, FEATURE_KEYS.orgPolicies)).toBe(false);
    expect(hasFeature(e, FEATURE_KEYS.auditExport)).toBe(false);
  });

  it("Organization grants the Team features plus every Organization-exclusive gate", () => {
    const e = entitlementFromSubscription(sub(planOf("organization")), "own")!;
    expect(e.planSlug).toBe("organization");
    expect(e.maxMembers).toBe(1000);
    expect(hasFeature(e, FEATURE_KEYS.teamWorkspace)).toBe(true);
    expect(hasFeature(e, FEATURE_KEYS.customThresholds)).toBe(true);
    expect(hasFeature(e, FEATURE_KEYS.organizationWorkspace)).toBe(true);
    expect(hasFeature(e, FEATURE_KEYS.orgPolicies)).toBe(true);
    expect(hasFeature(e, FEATURE_KEYS.auditExport)).toBe(true);
  });

  it("a pending plan does NOT grant paid features even on the Organization plan", () => {
    const e = entitlementFromSubscription(sub(planOf("organization"), "pending"), "own");
    expect(e).toBeNull();
  });

  it("an expired Organization subscription drops the user back to free", () => {
    const expired = entitlementFromSubscription(sub(planOf("organization"), "expired"), "own");
    expect(expired).toBeNull();
  });

  it("plan switch from Organization to Team drops the org-exclusive gates immediately", () => {
    expect(hasFeature(entitlementFromSubscription(sub(planOf("organization")), "own")!, FEATURE_KEYS.auditExport)).toBe(true);
    const afterSwitch = entitlementFromSubscription(sub(planOf("team")), "own")!;
    expect(afterSwitch.planSlug).toBe("team");
    expect(hasFeature(afterSwitch, FEATURE_KEYS.auditExport)).toBe(false);
    expect(hasFeature(afterSwitch, FEATURE_KEYS.organizationWorkspace)).toBe(false);
  });

  it("Organization outranks Team when entitlements merge", () => {
    const a = entitlementFromSubscription(sub(planOf("team")), "own")!;
    const b = entitlementFromSubscription(sub(planOf("organization")), "workspace")!;
    const merged = mergeEntitlements(a, b)!;
    expect(merged.planSlug).toBe("organization");
    expect(hasFeature(merged, FEATURE_KEYS.auditExport)).toBe(true);
    expect(merged.maxMembers).toBe(1000);
    expect(merged.source).toBe("workspace");
  });
});