import type { NextRequest } from "next/server";

/**
 * Client IP for rate limiting and audit logs.
 *
 * `x-forwarded-for` is an append-only list in which every proxy adds the peer
 * it received the request from: `client, proxy1, proxy2`. The *leftmost* entry
 * is therefore the value a client can freely choose by sending its own header,
 * so reading it lets anyone mint a fresh identity per request and walk straight
 * through a per-IP limit. The rightmost entry is the one appended by our own
 * infrastructure and is the only one we can attribute.
 *
 * `x-vercel-forwarded-for` / `cf-connecting-ip` are single-value headers set by
 * the edge and overwritten (not appended) on each hop, so they are preferred
 * when present. They are still client-spoofable on a direct-to-origin
 * deployment, which is why the same helper is only ever used for rate limiting
 * and logging — never for authorization.
 */
export function getClientIp(req: NextRequest): string {
  return clientIpFromHeaders(req.headers);
}

/** Same rule, for callers holding a bare `Headers` (e.g. `await headers()`). */
export function clientIpFromHeaders(headers: Headers): string {
  const edge = headers.get("x-vercel-forwarded-for") ?? headers.get("cf-connecting-ip");
  if (edge) {
    const first = edge.split(",")[0]?.trim();
    if (first) return first;
  }

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded
      .split(",")
      .map((hop) => hop.trim())
      .filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1] as string;
  }

  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  return "unknown";
}
