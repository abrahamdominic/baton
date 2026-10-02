import { describe, it, expect } from "vitest";
import { jsonLdScriptContent } from "./json-ld";

/**
 * A JSON-LD block is raw text to the HTML tokenizer: `</script>` inside a JSON
 * string closes the element, and everything after it is parsed as markup. A
 * repo name, org name, or FAQ answer that reaches JSON-LD therefore has to be
 * escaped at the point of embedding, not just JSON-encoded.
 */
describe("jsonLdScriptContent", () => {
  it("cannot be closed early with a script end tag", () => {
    const out = jsonLdScriptContent({ name: "evil</script><img src=x onerror=alert(1)>" });
    expect(out).not.toContain("</script>");
    expect(out).not.toContain("<");
    // Still the same value once parsed.
    expect(JSON.parse(out).name).toBe("evil</script><img src=x onerror=alert(1)>");
  });

  it("neutralises the HTML comment open sequence too", () => {
    const out = jsonLdScriptContent({ name: "<!--" });
    expect(out).not.toContain("<!--");
    expect(JSON.parse(out).name).toBe("<!--");
  });

  it("escapes ampersands so entities cannot be smuggled through", () => {
    const out = jsonLdScriptContent({ name: "&lt;b&gt;" });
    expect(out).not.toContain("&lt;");
    expect(JSON.parse(out).name).toBe("&lt;b&gt;");
  });

  it("escapes JavaScript line terminators that are legal in JSON", () => {
    const out = jsonLdScriptContent({ name: "a b c" });
    expect(out).not.toMatch(/[\u2028\u2029]/);
    expect(JSON.parse(out).name).toBe("a b c");
  });

  it("leaves ordinary content untouched", () => {
    const value = { "@context": "https://schema.org", name: "Baton" };
    expect(jsonLdScriptContent(value)).toBe(JSON.stringify(value));
  });
});
