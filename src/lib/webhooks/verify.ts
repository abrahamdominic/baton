import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify a GitHub webhook signature (`x-hub-signature-256: sha256=…`).
 * Constant-time; returns false (never throws) on any mismatch.
 */
export function verifyWebhookSignature(
  secret: string,
  rawBody: string | Buffer,
  signatureHeader: string | null,
): boolean {
  if (!secret || !signatureHeader) return false;
  if (!signatureHeader.startsWith("sha256=")) return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = signatureHeader.slice("sha256=".length);

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}