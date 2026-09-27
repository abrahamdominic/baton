import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  FEATURE_KEYS,
  type Entitlement,
  type PlanRecord,
  type SubscriptionRecord,
} from "./types";
import {
  FREE_PLAN_LIMITS,
  entitlementFromSubscription,
  featureMapFromLimits,
  freeEntitlement,
  hasFeature,
  mergeEntitlements,
  parsePlanLimits,
} from "./entitlement";
import { betterPlan } from "./entitlement-core";
import { planOf } from "./test-fixtures";

/**
 * Security boundary tests for the entitlement layer.
 *
 * Every decision here is made from the stored plan row and the subscription
 * status, never from anything the client sends, so a forged plan id, a forged
 * price, or a forged status cannot widen access.
 */

function sub(plan: PlanRecord, status: SubscriptionRecord["status"] = "active"): SubscriptionRecord {
  return {
    id: "sub-1",
    user_id: "user-1",
    plan_id: plan.id,
    status,
    payment_provider: "stripe",
    provider_customer_id: null,
    provider_subscription_id: null,
    current_period_start: "2026-01-01T00:00:00.000Z",
    current_period_end: "2099-12-01T00:00:00.000Z",
    cancel_at_period_end: false,
    canceled_at: null,
    started_at: "2026-01-01T00:00:00.000Z",
    ended_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    plan,
  };
}

const TEAM = planOf("team");
const ORG = planOf("organization");

describe("free plan grants no paid capability", () => {
  const free = freeEntitlement(null);

  it("grants no paid feature", () => {
    for (const key of Object.values(FEATURE_KEYS)) {
      expect(hasFeature(free, key), key).toBe(false);
    }
  });

  it("grants no paid access and a bounded repo cap", () => {
    expect(free.hasPaidAccess).toBe(false);
    expect(free.planSlug).toBe("free");
    expect(free.maxRepos).toBe(FREE_PLAN_LIMITS.maxRepos);
  });

  it("drops unknown feature strings from the stored limits", () => {
    const parsed = parsePlanLimits({
      ...FREE_PLAN_LIMITS,
      features: ["not_a_real_feature", "__proto__", "constructor", 42, null],
    });
    expect(parsed.features).toEqual([]);
  });

  it("cannot be prototype-polluted through the stored limits", () => {
    const map = featureMapFromLimits(
      parsePlanLimits({ ...FREE_PLAN_LIMITS, features: ["__proto__", "constructor"] }),
    );
    expect(Object.keys(map)).toEqual([]);
    expect(Object.prototype.hasOwnProperty.call(map, "__proto__")).toBe(false);
    expect(hasFeature({ ...free, features: map }, FEATURE_KEYS.organizationWorkspace)).toBe(false);
  });

  it("keeps a feature the plan legitimately declares", () => {
    const parsed = parsePlanLimits({
      ...FREE_PLAN_LIMITS,
      features: [FEATURE_KEYS.organizationWorkspace, "not_a_real_feature"],
    });
    expect(parsed.features).toEqual([FEATURE_KEYS.organizationWorkspace]);
  });
});

describe("Team subscription unlocks Team, not Organization", () => {
  const team = entitlementFromSubscription(sub(TEAM), "own")!;

  it("grants the Team workspace and custom thresholds", () => {
    expect(hasFeature(team, FEATURE_KEYS.teamWorkspace)).toBe(true);
    expect(hasFeature(team, FEATURE_KEYS.customThresholds)).toBe(true);
  });

  it("does not grant Organization-only capabilities (Team -> Org escalation)", () => {
    expect(hasFeature(team, FEATURE_KEYS.organizationWorkspace)).toBe(false);
    expect(hasFeature(team, FEATURE_KEYS.orgPolicies)).toBe(false);
    expect(hasFeature(team, FEATURE_KEYS.auditExport)).toBe(false);
  });

  it("keeps the Team member cap", () => {
    expect(team.maxMembers).toBe(25);
  });
});

describe("Organization subscription unlocks Organization", () => {
  const org = entitlementFromSubscription(sub(ORG), "own")!;

  it("grants every Organization capability", () => {
    expect(hasFeature(org, FEATURE_KEYS.organizationWorkspace)).toBe(true);
    expect(hasFeature(org, FEATURE_KEYS.orgPolicies)).toBe(true);
    expect(hasFeature(org, FEATURE_KEYS.auditExport)).toBe(true);
  });

  it("also inherits the Team capabilities", () => {
    expect(hasFeature(org, FEATURE_KEYS.teamWorkspace)).toBe(true);
    expect(hasFeature(org, FEATURE_KEYS.customThresholds)).toBe(true);
  });

  it("is not merely Team with a different label", () => {
    expect(org.planSlug).not.toBe(team().planSlug);
  });
});

function team(): Entitlement {
  return entitlementFromSubscription(sub(TEAM), "own")!;
}

describe("expired or cancelled subscriptions lose access", () => {
  for (const status of ["canceled", "expired", "payment_failed", "pending"] as const) {
    it(`a ${status} subscription resolves to free`, () => {
      expect(entitlementFromSubscription(sub(ORG, status), "own")).toBeNull();
      const gated = freeEntitlement(sub(ORG, status));
      expect(gated.hasPaidAccess).toBe(false);
      expect(hasFeature(gated, FEATURE_KEYS.organizationWorkspace)).toBe(false);
      expect(hasFeature(gated, FEATURE_KEYS.auditExport)).toBe(false);
    });
  }

  it("keeps access during the past_due dunning grace period", () => {
    // `past_due` is a real Stripe state, not a cancel: the customer is retried
    // before access is cut off, so paid features stay available.
    const pastDue = entitlementFromSubscription(sub(ORG, "past_due"), "own")!;
    expect(pastDue.hasPaidAccess).toBe(true);
    expect(hasFeature(pastDue, FEATURE_KEYS.organizationWorkspace)).toBe(true);
  });

  it("cuts off past_due access once the paid period has actually ended", () => {
    const lapsed = sub(ORG, "past_due");
    lapsed.current_period_end = "2020-01-01T00:00:00.000Z";
    expect(entitlementFromSubscription(lapsed, "own")).toBeNull();
  });

  it("a subscription whose period has already ended resolves to free", () => {
    const expired = sub(ORG);
    expired.current_period_end = "2020-01-01T00:00:00.000Z";
    expect(entitlementFromSubscription(expired, "own")).toBeNull();
  });

  it("keeps access while a cancellation is only scheduled for period end", () => {
    const cancelling = sub(ORG);
    cancelling.cancel_at_period_end = true;
    expect(entitlementFromSubscription(cancelling, "own")).not.toBeNull();
  });

  it("still surfaces the non-active status so the UI can explain why", () => {
    const gated = freeEntitlement(sub(ORG, "past_due"));
    expect(gated.planSlug).toBe("free");
    expect(gated.status).toBe("past_due");
  });
});

describe("gifted plans use the same entitlement system", () => {
  it("a gifted Team plan resolves exactly like a paid Team plan", () => {
    const paid = entitlementFromSubscription(sub(TEAM), "own")!;
    const giftedRecord = { ...sub(TEAM), payment_provider: "gift" as const };
    const gifted = entitlementFromSubscription(giftedRecord, "own")!;

    expect(gifted.planSlug).toBe(paid.planSlug);
    expect(gifted.features).toEqual(paid.features);
    expect(gifted.maxMembers).toBe(paid.maxMembers);
    expect(hasFeature(gifted, FEATURE_KEYS.teamWorkspace)).toBe(true);
    expect(hasFeature(gifted, FEATURE_KEYS.organizationWorkspace)).toBe(false);
    // A gift is a normal subscription row, so it resolves through the same
    // "own" path as a self-serve purchase and needs no separate entitlement.
    expect(gifted.source).toBe("own");
  });

  it("a gifted Organization plan still unlocks Organization features", () => {
    const gifted = entitlementFromSubscription(
      { ...sub(ORG), payment_provider: "gift" },
      "own",
    )!;
    expect(hasFeature(gifted, FEATURE_KEYS.organizationWorkspace)).toBe(true);
    expect(hasFeature(gifted, FEATURE_KEYS.auditExport)).toBe(true);
  });

  it("a gifted plan that has been revoked falls back to free", () => {
    const revoked = { ...sub(ORG), payment_provider: "gift" as const, status: "expired" as const };
    expect(entitlementFromSubscription(revoked, "own")).toBeNull();
  });
});

describe("a client cannot widen access by forging a subscription record", () => {
  it("ignores a subscription whose plan row is missing", () => {
    const orphaned = { ...sub(ORG), plan: null as unknown as PlanRecord };
    expect(entitlementFromSubscription(orphaned, "own")).toBeNull();
  });

  it("ignores a null subscription", () => {
    expect(entitlementFromSubscription(null, "own")).toBeNull();
  });

  it("derives every capability from the stored plan limits, not from the plan name", () => {
    // A plan literally named "Organization" but with Team limits must not grant
    // Organization features: the enforcement layer is the limits object.
    const impostor: PlanRecord = { ...TEAM, id: "plan_impostor", name: "Organization" };
    const e = entitlementFromSubscription(sub(impostor), "own")!;
    expect(e.planName).toBe("Organization");
    expect(hasFeature(e, FEATURE_KEYS.organizationWorkspace)).toBe(false);
    expect(hasFeature(e, FEATURE_KEYS.auditExport)).toBe(false);
  });

  it("treats a plan with no limits object as granting no gated feature", () => {
    const bare: PlanRecord = { ...TEAM, limits: {} };
    const e = entitlementFromSubscription(sub(bare), "own")!;
    for (const key of Object.values(FEATURE_KEYS)) {
      expect(hasFeature(e, key), key).toBe(false);
    }
  });
});

describe("merging a workspace entitlement never downgrades a stronger plan", () => {
  const own = entitlementFromSubscription(sub(TEAM), "own")!;
  const org = entitlementFromSubscription(sub(ORG), "workspace")!;

  it("prefers Organization when both are present", () => {
    const merged = mergeEntitlements(own, org)!;
    expect(merged.planSlug).toBe("organization");
    expect(hasFeature(merged, FEATURE_KEYS.organizationWorkspace)).toBe(true);
    expect(hasFeature(merged, FEATURE_KEYS.auditExport)).toBe(true);
  });

  it("never removes a feature the winner already grants", () => {
    const merged = mergeEntitlements(org, own)!;
    for (const key of Object.values(FEATURE_KEYS)) {
      expect(hasFeature(merged, key), key).toBe(hasFeature(org, key) || hasFeature(own, key));
    }
  });

  it("merging free with free stays free", () => {
    const merged = mergeEntitlements(freeEntitlement(null), freeEntitlement(null))!;
    expect(merged.hasPaidAccess).toBe(false);
  });
});

describe("plan ordering", () => {
  it("ranks free below Team below Organization", () => {
    expect(betterPlan({ slug: "free", name: "Free" }, { slug: "team", name: "Team" })?.slug).toBe("team");
    expect(
      betterPlan({ slug: "team", name: "Team" }, { slug: "organization", name: "Organization" })?.slug,
    ).toBe("organization");
    expect(
      betterPlan({ slug: "organization", name: "Organization" }, { slug: "team", name: "Team" })?.slug,
    ).toBe("organization");
  });
});
