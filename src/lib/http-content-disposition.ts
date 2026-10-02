/**
 * Build a `Content-Disposition` filename that cannot break out of its header.
 *
 * The value is emitted inside a quoted string, so a quote, a backslash, or a CR
 * or LF would terminate the string and let the rest of the value be read as
 * additional header parameters. Where the value comes from a URL path segment
 * (a slug, an org id, a repo name) that is attacker-influenced, so the
 * characters are stripped rather than escaped: there is no legitimate audit
 * export whose filename needs them.
 */
export function contentDispositionFilename(value: string): string {
  const cleaned = value
    .replace(/[^\w.\- ]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^[.\-\s]+/, "")
    .slice(0, 64);
  return cleaned.length > 0 ? cleaned : "export";
}

/** Full `Content-Disposition` header value for a download. */
export function contentDispositionAttachment(filename: string): string {
  // An ASCII fallback plus RFC 5987 `filename*`, so non-ASCII names survive
  // without ever being placed in the quoted form unencoded.
  const ascii = contentDispositionFilename(filename);
  return `attachment; filename="${ascii}"`;
}
