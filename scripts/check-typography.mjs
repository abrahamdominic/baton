#!/usr/bin/env node
/**
 * Typography guard.
 *
 * Baton forbids a small set of characters and patterns everywhere copy can
 * appear: rendered JSX text, locale resources, metadata, alt text, aria labels,
 * docs and code comments that ship to the browser. This script is the
 * enforcement point, and `npm run lint` runs it, so a violation fails the build
 * instead of shipping.
 *
 * Forbidden:
 *   - U+2014 em dash and U+2013 en dash, including dashed ranges
 *   - unicode arrows and arrow-like supplemental symbols
 *   - middle dots (U+00B7), bullets (U+2022) and the multiplication sign
 *     (U+00D7) when used as a marker or separator
 *   - check mark glyphs (U+2713, U+2714)
 *   - emoji and pictographic symbol ranges
 *   - a run of three or more hyphens outside code fences and frontmatter
 *
 * Structural exclusions are deliberately applied so the guard reports real
 * problems rather than syntax:
 *   - fenced code blocks (``` or ~~~) and leading YAML frontmatter are skipped,
 *     because a flag like `--force` or a table under a fence is not prose
 *   - a markdown table delimiter row (`| --- | --- |`) is skipped, because the
 *     hyphens are table syntax that never renders as dash characters
 *   - the hyphen-run rule only inspects comments and markdown prose, never code.
 *     A PEM header (`-----BEGIN`) is mandatory syntax, not a separator, and must
 *     not be flagged or rewritten.
 *
 * Run: node scripts/check-typography.mjs
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const SCAN_DIRS = ["src", "locales", "public", "docs"];
const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".woff", ".woff2",
  ".ttf", ".otf", ".eot", ".pdf", ".zip", ".gz", ".mp4", ".webm", ".map",
]);
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", ".vercel", "dist", "build", "coverage"]);

/** Each entry: a matcher plus a stable name for the report. */
const CHAR_RULES = [
  { name: "em dash (U+2014)", re: /\u2014/g },
  { name: "en dash (U+2013)", re: /\u2013/g },
  { name: "middle dot (U+00B7)", re: /\u00B7/g },
  { name: "bullet (U+2022)", re: /\u2022/g },
  { name: "multiplication sign (U+00D7)", re: /\u00D7/g },
  { name: "check mark (U+2713)", re: /\u2713/g },
  { name: "heavy check mark (U+2714)", re: /\u2714/g },
  { name: "unicode arrow", re: /[\u2190-\u21FF\u2900-\u297F]/g },
  { name: "dingbat symbol", re: /[\u2700-\u27BF\u2B00-\u2BFF]/g },
  { name: "emoji / pictograph", re: /[\u{1F000}-\u{1FAFF}\u{FE0F}]/gu },
  { name: "misc symbol", re: /[\u2600-\u26FF]/g },
];

const HYPHEN_RUN = /-{3,}/g;
const MD_TABLE_ROW = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;

/**
 * HTML entities that render as a forbidden glyph. A literal middle dot in JSX
 * and `&middot;` are the same character on screen, so the guard has to catch
 * both or the rule is trivial to bypass.
 */
const ENTITY_RULES = [
  { name: "middle dot entity", re: /&(?:middot|centerdot|sdot|#183|#x0*[bB]7);/g },
  { name: "dash entity", re: /&(?:mdash|ndash|#821[12]|#x201[34]);/g },
  { name: "arrow entity", re: /&(?:larr|rarr|uarr|darr|harr|lArr|rArr|hArr|#859[2-6]|#x219[0-9a-fA-F]);/g },
  { name: "bullet entity", re: /&(?:bull|#8226|#x2022);/g },
  { name: "multiplication entity", re: /&(?:times|#215|#xD7);/g },
  { name: "check entity", re: /&(?:check|#10003|#10004|#x2713|#x2714);/g },
];

/** Strip fenced code blocks and leading frontmatter, line by line. */
function stripStructural(text) {
  const lines = text.split("\n");
  const out = [];
  let fence = null;
  let inFrontmatter = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Frontmatter only counts at the very top of a markdown file.
    if (i === 0 && line.trim() === "---") {
      inFrontmatter = true;
      out.push("");
      continue;
    }
    if (inFrontmatter) {
      if (line.trim() === "---") inFrontmatter = false;
      out.push("");
      continue;
    }
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0].repeat(3);
      else if (line.trim().startsWith(fence)) fence = null;
      out.push("");
      continue;
    }
    if (fence) {
      out.push("");
      continue;
    }
    out.push(line);
  }
  return out;
}

function reportForFile(file, text) {
  const lines = stripStructural(text);
  const hits = [];
  const isMarkdown = /\.(md|mdx)$/i.test(file);
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Track `/* ... */` so a JSDoc separator line counts as a comment.
    const opensBlock = line.includes("/*");
    const wasInBlock = inBlockComment;
    if (opensBlock) inBlockComment = !line.includes("*/");
    if (wasInBlock && line.includes("*/")) inBlockComment = false;

    const isCommentLine =
      !isMarkdown && (trimmed.startsWith("//") || trimmed.startsWith("*") || wasInBlock || opensBlock);

    // Table rows are structural, not prose.
    if (isMarkdown && MD_TABLE_ROW.test(line)) continue;

    for (const rule of CHAR_RULES) {
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(line)) !== null) {
        hits.push({ line: i + 1, col: m.index + 1, name: rule.name, char: m[0] });
      }
    }

    for (const rule of ENTITY_RULES) {
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(line)) !== null) {
        hits.push({ line: i + 1, col: m.index + 1, name: rule.name, char: m[0] });
      }
    }

    // The hyphen-run rule applies to prose and comments only, never code.
    if (isMarkdown || isCommentLine) {
      HYPHEN_RUN.lastIndex = 0;
      let hm;
      while ((hm = HYPHEN_RUN.exec(line)) !== null) {
        if (isMarkdown && line.includes("|")) continue;
        hits.push({ line: i + 1, col: hm.index + 1, name: "run of three or more hyphens", char: hm[0] });
      }
    }
  }
  return hits;
}

function collectFiles(dir, acc) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collectFiles(full, acc);
    } else {
      const dot = entry.name.lastIndexOf(".");
      const ext = dot === -1 ? "" : entry.name.slice(dot).toLowerCase();
      if (BINARY_EXT.has(ext)) continue;
      acc.push(full);
    }
  }
  return acc;
}

const files = [];
for (const dir of SCAN_DIRS) {
  const full = join(root, dir);
  try {
    if (statSync(full).isDirectory()) collectFiles(full, files);
  } catch {
    /* directory may not exist */
  }
}
// Root markdown files.
for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (entry.isFile() && /\.(md|mdx)$/i.test(entry.name)) files.push(join(root, entry.name));
}

let total = 0;
for (const file of files.sort()) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const hits = reportForFile(file, text);
  if (hits.length === 0) continue;
  total += hits.length;
  console.error(`\n${relative(root, file)}`);
  for (const h of hits) {
    console.error(`  ${h.line}:${h.col}  ${h.name}  "${h.char}"`);
  }
}

if (total > 0) {
  console.error(`\n${total} typography violation(s) found.`);
  process.exit(1);
}

console.log(`Typography check passed across ${files.length} file(s).`);
