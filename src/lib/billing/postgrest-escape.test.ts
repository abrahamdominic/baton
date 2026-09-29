import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { escapePostgrestLike } from "./payments";

/**
 * `.or()` accepts a PostgREST filter mini-language, not a literal. A value
 * pasted into the admin payments search box is operator input, and the
 * grammar characters let it terminate the intended predicate and append one
 * of the operator's own. Escaping keeps the search a single literal value.
 */
describe("escapePostgrestLike", () => {
  it("neutralises a predicate separator so extra conditions cannot be appended", () => {
    // The comma that would start a second predicate is gone, and the dots that
    // would make the tail a well-formed `column.operator.value` are stripped,
    // so what remains is inert text inside the first predicate.
    const escaped = escapePostgrestLike("abc,is_verified.eq.true");
    expect(escaped).not.toContain(",");
    expect(escaped).not.toContain(".");
    expect(escaped.startsWith("abc")).toBe(true);
  });

  it("removes the quote and paren delimiters used to close a predicate", () => {
    const escaped = escapePostgrestLike(`x"),or(user_id.not.is.null`);
    expect(escaped).not.toContain(",");
    expect(escaped).not.toContain("(");
    expect(escaped).not.toContain(")");
    expect(escaped).not.toContain('"');
  });

  it("escapes LIKE wildcards so a search cannot become a prefix scan", () => {
    expect(escapePostgrestLike("100%")).toBe("100\\%");
    expect(escapePostgrestLike("a_b")).toBe("a\\_b");
  });

  it("escapes backslashes before anything else so escaping is not defeated", () => {
    // A trailing backslash must not swallow the escape added for the next char,
    // and an attacker-supplied backslash must not be able to un-escape ours.
    expect(escapePostgrestLike("a\\")).toBe("a\\\\");
    expect(escapePostgrestLike("a\\,b")).toBe("a\\\\b");
  });

  it("leaves an ordinary hash or id untouched", () => {
    expect(escapePostgrestLike("0xabc123")).toBe("0xabc123");
    expect(escapePostgrestLike("clh1234567890")).toBe("clh1234567890");
  });

  it("is idempotent for already-safe input so double-escaping cannot drift", () => {
    const once = escapePostgrestLike("plain-value");
    expect(escapePostgrestLike(once)).toBe(once);
  });
});
