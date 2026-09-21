import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhookSignature } from "./verify";

const SECRET = "s3cr3t-webhook-key";
const BODY = JSON.stringify({ action: "opened", number: 42 });

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

describe("verifyWebhookSignature", () => {
  it("accepts a correctly signed body", () => {
    expect(verifyWebhookSignature(SECRET, BODY, sign(BODY))).toBe(true);
  });

  it("accepts a Buffer body", () => {
    expect(verifyWebhookSignature(SECRET, Buffer.from(BODY), sign(BODY))).toBe(true);
  });

  it("rejects a tampered body", () => {
    const tampered = JSON.stringify({ action: "opened", number: 43 });
    expect(verifyWebhookSignature(SECRET, tampered, sign(BODY))).toBe(false);
  });

  it("rejects the wrong secret", () => {
    expect(verifyWebhookSignature(SECRET, BODY, sign(BODY, "other-secret"))).toBe(false);
  });

  it("rejects missing or malformed headers", () => {
    expect(verifyWebhookSignature(SECRET, BODY, null)).toBe(false);
    expect(verifyWebhookSignature(SECRET, BODY, "")).toBe(false);
    expect(verifyWebhookSignature(SECRET, BODY, "sha1=deadbeef")).toBe(false);
    expect(verifyWebhookSignature(SECRET, BODY, "sha256=not-hex")).toBe(false);
  });

  it("rejects an empty secret (never verifies with no config)", () => {
    expect(verifyWebhookSignature("", BODY, sign(BODY))).toBe(false);
  });
});
