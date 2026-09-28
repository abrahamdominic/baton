import { describe, it, expect } from "vitest";
import { parseCodeowners, likelyOwners } from "./codeowners";

const resolve = (raw: string, paths: string[]) => likelyOwners(raw, paths);
const ownersFor = (raw: string, path: string) => resolve(raw, [path]).map((m) => m.owner);

describe("parseCodeowners", () => {
  it("parses patterns with owners and keeps line numbers for citation", () => {
    const rules = parseCodeowners(["# comment", "", "* @acme/core", "docs/ @acme/docs"].join("\n"));
    expect(rules).toEqual([
      { pattern: "*", owners: ["@acme/core"], line: 3 },
      { pattern: "docs/", owners: ["@acme/docs"], line: 4 },
    ]);
  });

  it("normalises owners without an @ to GitHub's form", () => {
    expect(parseCodeowners("* acme/core")[0]!.owners).toEqual(["@acme/core"]);
  });

  it("keeps organisation team owners intact", () => {
    expect(parseCodeowners("* @acme/platform/db @bob")[0]!.owners).toEqual(["@acme/platform/db", "@bob"]);
  });

  it("drops a rule with no owners rather than letting it blank an earlier one", () => {
    const rules = parseCodeowners(["* @acme/core", "src/"].join("\n"));
    expect(rules).toHaveLength(1);
  });

  it("strips trailing comments", () => {
    expect(parseCodeowners("* @acme/core # default owners")[0]!.owners).toEqual(["@acme/core"]);
  });
});

describe("pattern semantics", () => {
  it("matches a slashless pattern at any depth", () => {
    expect(ownersFor("* @core", "src/lib/a.ts")).toEqual(["@core"]);
  });

  it("anchors a pattern containing a slash to the repository root", () => {
    // `docs/` must not match `src/docs/`, which is the classic bug here.
    expect(ownersFor("docs/ @docs", "src/docs/readme.md")).toEqual([]);
    expect(ownersFor("docs/ @docs", "docs/readme.md")).toEqual(["@docs"]);
  });

  it("treats a leading slash as root-anchored", () => {
    expect(ownersFor("/src/ @src", "src/a.ts")).toEqual(["@src"]);
    expect(ownersFor("/src/ @src", "packages/x/src/a.ts")).toEqual([]);
  });

  it("keeps * inside a path segment", () => {
    expect(ownersFor("src/*.ts @web", "src/page.ts")).toEqual(["@web"]);
    // `*` does not cross a slash, so a nested file is a different story.
    expect(ownersFor("src/*.ts @web", "src/app/page.ts")).toEqual([]);
    // And it must not match a longer extension.
    expect(ownersFor("src/*.ts @web", "src/page.tsx")).toEqual([]);
  });

  it("spans segments with **", () => {
    expect(ownersFor("src/** @core", "src/a/b/c/d.ts")).toEqual(["@core"]);
    expect(ownersFor("**/*.test.ts @qa", "src/lib/x.test.ts")).toEqual(["@qa"]);
  });
});

describe("last-match-wins and negation", () => {
  it("lets a later rule override an earlier owner", () => {
    expect(ownersFor(["* @acme/core", "src/ @acme/platform"].join("\n"), "src/a.ts")).toEqual([
      "@acme/platform",
    ]);
  });

  it("removes a previously matched owner with !", () => {
    // `!` negates the PATTERN and the owners on that line are removed from the
    // files it matches. That is GitHub's actual syntax.
    const rules = ["* @acme/core", "!src/generated/ @acme/core", "src/generated/ @acme/codegen"];
    expect(ownersFor(rules.join("\n"), "src/generated/api.ts")).toEqual(["@acme/codegen"]);
  });

  it("clears every owner for a bare negation, as GitHub documents", () => {
    // `!vendor/` lists no owners and means "owned by nobody".
    expect(resolve(["* @acme/core", "!vendor/"].join("\n"), ["vendor/lib.js"])).toEqual([]);
  });

  it("never lets a negated rule invent an owner", () => {
    // `!` alone matches nothing, so no owner may appear.
    expect(resolve("!src/ @nobody", ["src/a.ts"])).toEqual([]);
  });

  it("keeps the other owners from the same earlier rule when one is negated", () => {
    const raw = ["* @alice @bob", "!src/ @bob"].join("\n");
    expect(ownersFor(raw, "src/a.ts")).toEqual(["@alice"]);
    // Outside the negated scope both owners still apply.
    expect(ownersFor(raw, "docs/a.md")).toEqual(["@alice", "@bob"]);
  });

  it("is a no-op when a negated rule removes an owner nothing assigned", () => {
    const raw = ["* @alice", "!src/ @carol"].join("\n");
    expect(ownersFor(raw, "src/a.ts")).toEqual(["@alice"]);
  });

  it("removes only owners already assigned, so unrelated files are unaffected", () => {
    const raw = ["* @alice", "!src/ @alice"].join("\n");
    expect(ownersFor(raw, "src/a.ts")).toEqual([]);
    expect(ownersFor(raw, "docs/a.md")).toEqual(["@alice"]);
  });
});

describe("result shape", () => {
  it("groups the paths per owner and explains the matching rule", () => {
    const result = resolve("* @acme/core", ["src/a.ts", "src/b.ts", "docs/c.md"]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ owner: "@acme/core", rule: "*", line: 1 });
    expect(result[0]!.paths).toEqual(["src/a.ts", "src/b.ts", "docs/c.md"]);
  });

  it("orders the owner covering the most files first", () => {
    const result = resolve(["docs/ @docs", "src/ @src"].join("\n"), [
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
      "docs/x.md",
    ]);
    expect(result.map((r) => r.owner)).toEqual(["@src", "@docs"]);
    expect(result[0]!.paths).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
  });

  it("lets the last matching pattern win outright rather than merging owners", () => {
    // `docs/` is overridden by `*` for a file under docs, so @docs must not
    // also be reported. Merging would be the per-owner mistake.
    expect(ownersFor(["docs/ @docs", "* @core"].join("\n"), "docs/x.md")).toEqual(["@core"]);
  });

  it("matches a **/ prefix at the repository root as well as nested", () => {
    expect(ownersFor("**/*.test.ts @qa", "x.test.ts")).toEqual(["@qa"]);
  });

  it("returns nothing for an empty file, a missing file, or no changed paths", () => {
    expect(resolve("", ["src/a.ts"])).toEqual([]);
    expect(likelyOwners(null, ["src/a.ts"])).toEqual([]);
    expect(likelyOwners("* @core", [])).toEqual([]);
  });

  it("ignores changed paths no rule covers", () => {
    expect(ownersFor("src/ @src", "vendor/lib.js")).toEqual([]);
  });
});
