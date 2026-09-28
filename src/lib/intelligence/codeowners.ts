/**
 * CODEOWNERS resolution.
 *
 * aa.md §8 asks Baton to "identify CODEOWNERS affected by changes" and §11
 * asks for "likely owners" in a pull request. Baton can answer this exactly,
 * because the repository states the rule in a file it has already read — so
 * this is derivation, not inference, and the result is presented as a fact.
 *
 * The matching rules implemented here are GitHub's documented CODEOWNERS
 * semantics, which are not the same as `.gitignore`:
 *
 *  - a pattern without a slash matches at any depth (`docs` matches `a/docs/b`)
 *  - a pattern *with* a slash is anchored to the repository root
 *  - `#` starts a comment
 *  - `!` negates a rule, and a negated rule only removes a *previously matched*
 *    owner — it can never introduce one
 *  - later rules win, so the file is read top to bottom
 *  - `@org/team` is a valid owner
 *
 * Getting the last two wrong is the usual way these implementations become
 * untrustworthy: silently attributing a file to the wrong team is worse than
 * reporting nothing.
 */

export interface CodeownerRule {
  pattern: string;
  owners: string[];
  /** Line number in the CODEOWNERS file, for explaining a match. */
  line: number;
}

export interface CodeownerMatch {
  owner: string;
  /** The files this owner is responsible for among the changed ones. */
  paths: string[];
  rule: string;
  line: number;
}

/**
 * Parse a CODEOWNERS file into ordered rules.
 *
 * Comments and blank lines are dropped, but line numbers are preserved so a
 * match can cite `CODEOWNERS:14` rather than just asserting an owner.
 */
export function parseCodeowners(raw: string): CodeownerRule[] {
  const rules: CodeownerRule[] = [];
  raw.split(/\r?\n/).forEach((text, index) => {
    const line = text.replace(/#.*$/, "").trim();
    if (!line) return;
    const [pattern, ...rest] = line.split(/\s+/);
    if (!pattern) return;

    // `!` negates the PATTERN, and the owners on that line are the ones to
    // remove. The negation marker is stripped before the owner is normalised,
    // otherwise `!@bob` would be rewritten into the nonsense owner `@!@bob`.
    const cleaned = rest
      .map((o) => (o.startsWith("@") ? o : `@${o}`))
      .filter((o) => o.length > 1);

    if (pattern.startsWith("!")) {
      // A bare negation (`!vendor/`) is GitHub's documented way to strip every
      // owner from a path, so it is kept even with no owners listed.
      rules.push({ pattern, owners: cleaned, line: index + 1 });
      return;
    }
    // A plain rule with no owners can never own anything. Keeping it would let
    // it blank out an earlier real rule during the last-match pass.
    if (cleaned.length === 0) return;
    rules.push({ pattern, owners: cleaned, line: index + 1 });
  });
  return rules;
}

/**
 * Translate a CODEOWNERS glob into a regular expression anchored at both ends.
 *
 * Written as an explicit walk rather than chained replacements, because the
 * double-star forms mean different things and chained `replace` calls silently
 * get the ordering wrong. A globstar followed by a slash deliberately expands
 * to an optional non-capturing group, so that a pattern such as a globstar,
 * slash, then star-test-suffix also matches a test at the repository root.
 */
function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!;
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
          out += "(?:.*/)?";
        } else {
          out += ".*";
        }
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`);
}

/**
 * Every path a rule could be talking about: the file itself, plus each of its
 * ancestor directories.
 *
 * This is what makes `docs/` match `docs/readme.md` — the pattern names a
 * directory, and the directory is a prefix of the file. Without this a
 * trailing-slash rule silently matches nothing, which is the most common way
 * hand-rolled CODEOWNERS parsers under-report.
 */
function candidatePaths(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  const out: string[] = [];
  for (let i = parts.length; i > 0; i--) out.push(parts.slice(0, i).join("/"));
  return out;
}

function matchesRule(pattern: string, path: string): boolean {
  const negated = pattern.startsWith("!");
  const body = negated ? pattern.slice(1) : pattern;

  // GitHub anchors a pattern to the repository root when it contains a slash,
  // and lets a slashless pattern match at any depth. A trailing slash counts,
  // so `docs/` is anchored.
  const anchored = body.includes("/");
  const glob = body.replace(/^\//, "").replace(/\/$/, "");

  if (glob === "") return false;
  const re = globToRegExp(glob);
  const candidates = candidatePaths(path);

  if (anchored) {
    // Relative to the root: the whole candidate path has to match.
    return candidates.some((c) => re.test(c));
  }
  // Slashless: matches a single path segment at any depth.
  return candidates.some((c) => c.split("/").some((segment) => re.test(segment)));
}

/**
 * Resolve which owners are responsible for a set of changed paths.
 *
 * Follows last-match-wins with `!` negation, and returns one entry per owner
 * with the specific files they own, so a reviewer sees *why* they were picked
 * rather than an unexplained list of names.
 */
export function resolveCodeowners(rules: CodeownerRule[], changedPaths: string[]): CodeownerMatch[] {
  // path -> the owners that currently apply, plus the rule that last set them.
  const assignments = new Map<string, Map<string, { rule: string; line: number }>>();

  for (const path of changedPaths) {
    // GitHub's precedence is global, not per-owner: the owners of the LAST
    // matching pattern win outright. Merging owners across every matching
    // pattern would attribute files to teams whose rule a later line
    // deliberately overrode.
    const current = new Map<string, { rule: string; line: number }>();

    for (const rule of rules) {
      const negated = rule.pattern.startsWith("!");
      if (!matchesRule(rule.pattern, path)) continue;

      if (negated) {
        // A negated rule only removes owners an earlier rule assigned, so it
        // can never introduce one. GitHub's bare form, `!vendor/`, lists no
        // owners and means "these paths are owned by nobody".
        if (rule.owners.length === 0) current.clear();
        else for (const owner of rule.owners) current.delete(owner);
        continue;
      }
      current.clear();
      for (const owner of rule.owners) {
        current.set(owner, { rule: rule.pattern, line: rule.line });
      }
    }

    if (current.size > 0) assignments.set(path, current);
  }

  const byOwner = new Map<string, CodeownerMatch>();
  for (const [path, owners] of assignments) {
    for (const [owner, meta] of owners) {
      const existing = byOwner.get(owner);
      if (existing) {
        existing.paths.push(path);
      } else {
        byOwner.set(owner, { owner, paths: [path], rule: meta.rule, line: meta.line });
      }
    }
  }

  // Most files first: the owner a reviewer should act on is the one covering
  // the bulk of the change.
  return [...byOwner.values()].sort(
    (a, b) => b.paths.length - a.paths.length || a.owner.localeCompare(b.owner),
  );
}

/** Owners for a pull request, or `[]` when the repository has no usable rule. */
export function likelyOwners(
  codeownersRaw: string | null,
  changedPaths: string[],
): CodeownerMatch[] {
  if (!codeownersRaw || changedPaths.length === 0) return [];
  return resolveCodeowners(parseCodeowners(codeownersRaw), changedPaths);
}
