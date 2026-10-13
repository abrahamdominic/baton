import { NextResponse, type NextRequest } from "next/server";

/**
 * Per-request Content-Security-Policy nonce.
 *
 * A CSP is only worth having for `script-src`. `frame-ancestors`, `object-src`
 * and `base-uri` are worth setting, but the reason a policy exists is to stop an
 * injected `<script>` from running, and `'unsafe-inline'` in `script-src` gives
 * that permission back, which is why the nonce is the mechanism rather than an
 * inline-allowlist escape hatch.
 *
 * The nonce is per request because a per-build value is a per-build constant: it
 * would sit in the HTML of every cached page, so an injected script could read
 * its own permission out of a page it was already on. A fresh 128-bit value per
 * response means the only way to have the nonce at write time is to have the
 * injection.
 *
 * Next picks the nonce up from the request headers and applies it to the inline
 * flight-data scripts it emits, so the framework's own bootstrap is covered
 * without listing it anywhere. The two hand-written prepaint scripts in the root
 * layout read `x-nonce` and set it explicitly.
 *
 * `strict-dynamic` is what makes this stick: when a nonce or hash is present the
 * browser ignores host allowlists, so `script-src 'self'` no longer permits a
 * script from any origin we did not name. `'self'` is kept alongside it for the
 * browsers that do not implement `strict-dynamic`.
 */

/**
 * Read at call time rather than module scope so the policy a given request
 * receives is a function of the request, not of when this file happened to be
 * first imported.
 */
function isDev(): boolean {
  return process.env.NODE_ENV !== "production";
}

function buildCsp(nonce: string): string {
  // Development needs `eval` for React Fast Refresh and a websocket back to the
  // dev server; neither exists in a production build. `wasm-unsafe-eval` covers
  // WebAssembly instantiation and is not JavaScript `eval`.
  const scriptSrc = isDev()
    ? `'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval' 'wasm-unsafe-eval'`
    : `'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'`;

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // Next's stylesheet pipeline and the design system's runtime values are
    // injected as inline style attributes, which a style-src nonce cannot cover.
    // A style injection cannot exfiltrate a session cookie or execute script, so
    // this is a far smaller exposure than `script-src 'unsafe-inline'` would be.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://avatars.githubusercontent.com https://github.com",
    "font-src 'self' data:",
    // The USDC verification runs server-side against a JSON-RPC endpoint; nothing
    // in the browser needs one, so `connect-src` stays on the origin alone.
    "connect-src 'self'",
    // GitHub is reached by top-level navigation, not by form submission, so
    // closing `form-action` to the origin does not disturb install or OAuth.
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    ...(isDev() ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/**
 * 128 bits of entropy, base64 so it is a valid CSP nonce-source.
 *
 * Exported for the middleware test: the nonce has to be the same value in the
 * response policy and in the header the layout reads, and that equality is only
 * checkable from inside the module.
 */
export function mintCspNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}

/**
 * Headers the request is forwarded with.
 *
 * Both the request and the response need the policy, for different readers: the
 * response header is what the browser enforces, and the request header is what
 * Next reads to stamp its own inline scripts.
 */
export function cspRequestHeaders(req: NextRequest, nonce = mintCspNonce()): Headers {
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", buildCsp(nonce));
  return requestHeaders;
}

export function middleware(req: NextRequest) {
  const nonce = mintCspNonce();
  const requestHeaders = cspRequestHeaders(req, nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", buildCsp(nonce));
  return response;
}

export const config = {
  /**
   * Everything except immutable build output.
   *
   * Static assets never execute script, so a nonce on them is wasted work, and
   * excluding them keeps the middleware off the hot path for the chunks a page
   * actually requests.
   *
   * Prefetch responses are deliberately NOT excluded. Skipping them is the
   * usual Next.js recipe, but a header that is present on most responses to a
   * path and absent on some is exactly the shape of a policy bypass: any
   * request an attacker can decorate with `purpose: prefetch` would come back
   * without a Content-Security-Policy. The cost of running the middleware on a
   * prefetch is one header set.
   */
  matcher: [
    {
      source:
        "/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|robots.txt|sitemap.xml).*)",
    },
  ],
};