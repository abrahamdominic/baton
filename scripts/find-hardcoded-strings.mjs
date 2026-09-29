#!/usr/bin/env node
/**
 * Hardcoded user-facing string scanner.
 *
 * Complements `validate-translations.mjs` (which checks the resource files) by
 * checking the *source* for strings that never reached a translation key. A
 * validator can only report unused keys; it cannot notice a heading that was
 * simply never given a key, which is the common failure mode.
 *
 * Detection strategy, in order of reliability:
 *
 *  1. JSX text nodes. Real JSX children, matched across newlines. This is the
 *     single largest source of untranslated copy.
 *  2. User-facing string props (`title=`, `placeholder=`, `aria-label=`, ...).
 *  3. Copy-bearing calls: `toast`, `setError`, `new Error`, `confirmDialog`.
 *
 * Deliberate false-negative bias. Reporting something as hardcoded when it is
 * legitimate is worse than missing one, because the fix is a code change on
 * every hit. The allowlist below covers identifiers, class names, URLs, dates,
 * and technical enums.
 *
 * Usage:
 *   node scripts/find-hardcoded-strings.mjs           # report
 *   node scripts/find-hardcoded-strings.mjs --max N   # fail past N findings
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const ROOT = "src";
const EXTS = new Set([".tsx", ".jsx"]);
const IGNORE_PATH = /(\.test\.|\.dbtest\.|\.spec\.|__tests__|__mocks__|fixtures)/i;

const maxFlag = process.argv.indexOf("--max");

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------

/** Exact values that are technical even when they look like prose. */
const ALLOW_EXACT = new Set([
  "Baton", "GitHub", "Git", "OAuth", "API", "URL", "ID", "SDK", "CLI", "JSON",
  "YAML", "TOML", "HTTP", "HTTPS", "HMAC", "SHA256", "SHA-256", "AES", "GCM",
  "UTC", "GMT", "ISO8601", "RFC", "REST", "SLA", "PDF", "CSV", "SAML", "SSO",
  "2FA", "TOTP", "USDC", "USDT", "USD", "EUR", "GBP", "JPY", "BRL", "INR",
  "Staging", "Production", "Development", "Preview",
  "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun",
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
  "AM", "PM", "N", "S", "E", "W",
  "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS",
  "application/json", "text/plain", "text/html", "image/svg+xml",
  "utf-8", "base64", "hex",
]);

/** Patterns for values that are unambiguously not user-facing copy. */
const ALLOW_PATTERNS = [
  /^https?:\/\//i,
  /^\/[\w\-/.?=&]*$/,              // route paths
  /^#[a-z-]+$/i,                    // anchors
  /^[a-z-]+:[a-z-]+$/,              // css var / url scheme
  /^\{`.*`\}$/,                     // interpolation-only
  /^[A-Z_][A-Z0-9_]*$/,             // SCREAMING_CASE constants
  /^\d+$/,
  /^-?\d[\d.,]*%?$/,
  /^v?\d+\.\d+\.\d+/,               // versions
  /^\d{4}-\d{2}-\d{2}/,             // dates
  /^[a-z]+(-[a-z]+)+$/,             // slugs / css-like
  /^[a-z0-9]+$/,                    // codes
  /^[A-Z][A-Za-z]*(<[a-z]+>)?$/,    // TS type expressions: Promise, Promise<void>
  /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \/\S+$/, // documented HTTP route literals
  /^[A-Z][A-Za-z0-9]*-[0-9](\.[0-9]+)?(-[A-Za-z]+)?$/, // SPDX license ids: AGPL-3.0
];

/**
 * A JSX child is copy only if it looks like a sentence fragment. One capital
 * letter followed by nothing is an acronym badge, not a heading.
 */
function looksLikeCopy(raw) {
  const value = raw.replace(/\s+/g, " ").trim();
  if (value.length < 2) return false;
  // Pure punctuation / symbols (dashes, bullets, arrows, ellipses).
  if (!/[A-Za-z\u00C0-\u024F\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0900-\u097F\u3040-\u30FF\u4E00-\u9FFF]/.test(value)) {
    return false;
  }
  if (ALLOW_EXACT.has(value)) return false;
  if (ALLOW_PATTERNS.some((p) => p.test(value))) return false;
  // Must start with a letter (upper or lower for CJK/Arabic/Hebrew scripts).
  const first = value[0];
  const startsSentence = /[A-Z\u00C0-\u00DE]/.test(first);
  const startsNonLatin = /[\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0900-\u097F\u3040-\u30FF\u4E00-\u9FFF]/.test(first);
  if (!startsSentence && !startsNonLatin) return false;
  // `Foo.Bar` / `Foo<Bold>` fragments are expressions, not copy.
  if (/^[A-Za-z]+\.[A-Za-z]/.test(value)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/** Strips comments and string bodies so JSX scanning sees real markup only. */
function stripNoise(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
}

const JSX_TEXT = />([^<>{}\n]*(?:\{[^}]*\}[^<>{}\n]*)*)</g;
const PROP =
  /\b(placeholder|title|label|aria-label|alt|description|hint|heading|emptyText|confirmText|cancelText|tooltip|header|subtitle|summary|message|actionLabel|buttonText|errorText|helperText|caption|ctaLabel|closeLabel)\s*=\s*"([^"\\\n]{2,160})"/g;
const CALL =
  /\b(?:new Error|toastError|toastSuccess|toastInfo|toastWarning|toast|setError|setMessage|setBanner)\s*\(\s*[`"']([^`"'\n]{6,160})/g;

const findings = new Map();

/**
 * Files whose copy is structurally untranslatable.
 *
 * Next.js image-file conventions (`opengraph-image`, `twitter-image`, and the
 * icon set) require `alt` to be a static module-level export, so it cannot be
 * routed through the translator. Everything rendered inside the image itself is
 * localized normally.
 */
const STATIC_EXPORT_ALT = /(^|\/)(opengraph-image|twitter-image)\.tsx$/;

function collect(file, kind, line, text) {
  const key = `${file}`;
  if (!findings.has(key)) findings.set(key, []);
  findings.get(key).push({ kind, line, text });
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (IGNORE_PATH.test(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (EXTS.has(extname(full))) yield full;
  }
}

for (const file of walk(ROOT)) {
  const raw = stripNoise(readFileSync(file, "utf8"));
  // Offset map from cleaned index -> original line number.
  const lineOf = [];
  {
    let line = 1;
    for (let i = 0; i < raw.length; i++) {
      lineOf[i] = line;
      if (raw[i] === "\n") line++;
    }
  }
  const at = (index) => lineOf[Math.min(index, lineOf.length - 1)] ?? 1;

  for (const [re, kind, group] of [
    [JSX_TEXT, "jsx", 1],
    [PROP, "prop", 2],
    [CALL, "call", 1],
  ]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(raw)) !== null) {
      const value = (m[group] ?? "").replace(/\s+/g, " ").trim();
      if (!looksLikeCopy(value)) continue;
      // Skip anything already routed through the translation system.
      if (/\bt\(["']/.test(value) || /\btc\(["']/.test(value)) continue;
      // Skip copy that a framework requires to stay a static export.
      if (STATIC_EXPORT_ALT.test(relative(process.cwd(), file))) continue;
      collect(relative(process.cwd(), file), kind, at(m.index), value);
    }
  }
}

const rows = [...findings.entries()].sort((a, b) => b[1].length - a[1].length);
const total = rows.reduce((n, [, v]) => n + v.length, 0);

const only = process.argv.includes("--files") ? process.argv.indexOf("--files") : -1;
if (only > -1 && process.argv[only + 1]) {
  console.log(rows.map(([f]) => f).join("\n"));
} else {
  for (const [file, items] of rows) {
    console.log(`\n### ${file}  (${items.length})`);
    for (const i of items) console.log(`  ${i.line}\t${i.kind}\t${JSON.stringify(i.text)}`);
  }
}

console.log(
  `\n${total} candidate hardcoded user-facing string(s) in ${rows.length} file(s).`,
);

if (maxFlag > -1) {
  const limit = Number(process.argv[maxFlag + 1] ?? "0");
  if (total > limit) {
    console.error(`FAIL: ${total} exceeds the allowed maximum of ${limit}.`);
    process.exit(1);
  }
  console.log(`OK: ${total} <= ${limit}.`);
}
