import { describe, it, expect } from "vitest";
import { contentDispositionFilename } from "./http-content-disposition";

describe("contentDispositionFilename", () => {
  it("keeps ordinary ids intact", () => {
    expect(contentDispositionFilename("org_123")).toBe("org_123");
    expect(contentDispositionFilename("acme-inc")).toBe("acme-inc");
  });

  it("strips a quote so the value cannot close the header string", () => {
    expect(contentDispositionFilename('a"; x=1')).not.toContain('"');
  });

  it("strips CR and LF so a value cannot inject a header", () => {
    expect(contentDispositionFilename("a\r\nX-Injected: 1")).not.toMatch(/[\r\n]/);
  });

  it("strips path separators", () => {
    expect(contentDispositionFilename("../../etc/passwd")).not.toContain("/");
  });

  it("never returns an empty filename", () => {
    expect(contentDispositionFilename("")).toBe("export");
    expect(contentDispositionFilename("///")).toBe("export");
  });

  it("bounds the length", () => {
    expect(contentDispositionFilename("a".repeat(500)).length).toBeLessThanOrEqual(64);
  });
});
