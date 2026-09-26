import { describe, it, expect } from "vitest";
import {
  diagnoseStripe,
  isStripeConfigured,
  stripeSecretKeyIssue,
  stripeWebhookSecretFix,
  stripeWebhookSecretIssue,
  type Env,
} from "./config";

/**
 * Build an Env with only the Stripe fields set. `config.ts` has no other
 * required inputs, so a partial cast keeps these tests focused on the Stripe
 * decision rather than the whole environment schema.
 */
function env(overrides: Partial<Env> = {}): Env {
  return {
    STRIPE_SECRET_KEY: "",
    STRIPE_WEBHOOK_SECRET: "",
    STRIPE_MODE: "test",
    ...overrides,
  } as Env;
}

const GOOD = { STRIPE_SECRET_KEY: "sk_test_abc123", STRIPE_WEBHOOK_SECRET: "whsec_xyz789" };

describe("isStripeConfigured", () => {
  it("is true only when both a usable key and a whsec_ signing secret are present", () => {
    expect(isStripeConfigured(env(GOOD))).toBe(true);
  });

  it("is false when the webhook secret is missing entirely", () => {
    expect(isStripeConfigured(env({ ...GOOD, STRIPE_WEBHOOK_SECRET: "" }))).toBe(false);
  });

  it("is false when the API key is missing entirely", () => {
    expect(isStripeConfigured(env({ ...GOOD, STRIPE_SECRET_KEY: "" }))).toBe(false);
  });

  /**
   * Regression: the reported production state. The operator had pasted the
   * webhook endpoint URL instead of the signing secret, so the old boolean-only
   * check reported "missing" and gave no clue about the real mistake.
   */
  it("is false when the webhook secret is actually the endpoint URL", () => {
    const e = env({ ...GOOD, STRIPE_WEBHOOK_SECRET: "https://example.com/api/webhooks/stripe" });
    expect(isStripeConfigured(e)).toBe(false);
    expect(stripeWebhookSecretIssue(e)).toMatch(/not a Stripe signing secret/);
  });
});

describe("stripeSecretKeyIssue", () => {
  it("returns null for a well-formed key that matches the mode", () => {
    expect(stripeSecretKeyIssue(env({ STRIPE_SECRET_KEY: "sk_test_abc", STRIPE_MODE: "test" }))).toBeNull();
    expect(stripeSecretKeyIssue(env({ STRIPE_SECRET_KEY: "sk_live_abc", STRIPE_MODE: "live" }))).toBeNull();
  });

  it("catches a live key while STRIPE_MODE is still test", () => {
    const issue = stripeSecretKeyIssue(env({ STRIPE_SECRET_KEY: "sk_live_abc", STRIPE_MODE: "test" }));
    expect(issue).toMatch(/live-mode key but STRIPE_MODE is "test"/);
  });

  it("catches a test key while STRIPE_MODE is live", () => {
    const issue = stripeSecretKeyIssue(env({ STRIPE_SECRET_KEY: "sk_test_abc", STRIPE_MODE: "live" }));
    expect(issue).toMatch(/test-mode key but STRIPE_MODE is "live"/);
  });

  it("rejects a publishable key, which cannot create Checkout sessions", () => {
    expect(stripeSecretKeyIssue(env({ STRIPE_SECRET_KEY: "pk_test_abc" }))).toMatch(
      /does not look like a Stripe secret key/,
    );
  });

  it("rejects a restricted key, which cannot create Checkout sessions", () => {
    expect(stripeSecretKeyIssue(env({ STRIPE_SECRET_KEY: "rk_test_abc" }))).toMatch(
      /does not look like a Stripe secret key/,
    );
  });

  it("rejects a URL pasted into the key variable", () => {
    expect(stripeSecretKeyIssue(env({ STRIPE_SECRET_KEY: "https://dashboard.stripe.com/apikeys" }))).toMatch(
      /is a URL, not an API key/,
    );
  });

  it("treats an unset key as not-an-issue so the caller can report 'missing'", () => {
    expect(stripeSecretKeyIssue(env({ STRIPE_SECRET_KEY: "" }))).toBeNull();
  });
});

describe("stripeWebhookSecretFix", () => {
  it("tells the operator they pasted the endpoint URL instead of the signing secret", () => {
    const fix = stripeWebhookSecretFix(
      env({ STRIPE_WEBHOOK_SECRET: "https://example.com/api/webhooks/stripe" }),
    );
    expect(fix).toMatch(/ENDPOINT URL/);
    expect(fix).toMatch(/Signing secret/);
  });

  it("has no fix for a correct or unset secret", () => {
    expect(stripeWebhookSecretFix(env({ STRIPE_WEBHOOK_SECRET: "whsec_abc" }))).toBeNull();
    expect(stripeWebhookSecretFix(env({ STRIPE_WEBHOOK_SECRET: "" }))).toBeNull();
  });
});

describe("diagnoseStripe", () => {
  it("reports no issues and no fixes when fully configured", () => {
    const d = diagnoseStripe(env(GOOD));
    expect(d.configured).toBe(true);
    expect(d.issues).toEqual([]);
    expect(d.fixes).toEqual([]);
    expect(d.mode).toBe("test");
    expect(d.secretKeyPresent).toBe(true);
    expect(d.webhookSecretPresent).toBe(true);
  });

  it("names both variables when nothing is set", () => {
    const d = diagnoseStripe(env());
    expect(d.configured).toBe(false);
    expect(d.issues.join(" ")).toMatch(/STRIPE_SECRET_KEY is not set/);
    expect(d.issues.join(" ")).toMatch(/STRIPE_WEBHOOK_SECRET is not set/);
    expect(d.fixes.length).toBeGreaterThanOrEqual(1);
  });

  it("explains the endpoint-URL mistake precisely and is still unconfigured", () => {
    const d = diagnoseStripe(
      env({ STRIPE_SECRET_KEY: "sk_test_abc", STRIPE_WEBHOOK_SECRET: "https://example.com/webhooks" }),
    );
    expect(d.configured).toBe(false);
    expect(d.issues[0]).toMatch(/not a Stripe signing secret/);
    expect(d.fixes[0]).toMatch(/Reveal/);
  });

  it("never leaks a secret value in issues, fixes, or presence flags", () => {
    const d = diagnoseStripe(
      env({
        STRIPE_SECRET_KEY: "sk_test_super_secret_key_value",
        STRIPE_WEBHOOK_SECRET: "whsec_super_secret_value",
        STRIPE_MODE: "test",
      }),
    );
    const serialized = JSON.stringify(d);
    expect(serialized).not.toContain("super_secret");
  });

  it("does not fake readiness for a test-mode deployment with a live key", () => {
    const d = diagnoseStripe(
      env({ STRIPE_SECRET_KEY: "sk_live_abc", STRIPE_WEBHOOK_SECRET: "whsec_abc", STRIPE_MODE: "test" }),
    );
    expect(d.configured).toBe(false);
    expect(d.issues[0]).toMatch(/STRIPE_MODE/);
  });

  it("reports presence booleans rather than values so the UI can prove presence safely", () => {
    const d = diagnoseStripe(env({ STRIPE_SECRET_KEY: "sk_test_abc", STRIPE_WEBHOOK_SECRET: "" }));
    expect(d.secretKeyPresent).toBe(true);
    expect(d.webhookSecretPresent).toBe(false);
  });
});
