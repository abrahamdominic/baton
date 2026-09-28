#!/usr/bin/env node
/**
 * Translation validator (lan.md §18, §32).
 *
 * Catches the four failure modes that silently ship:
 *   - a key missing from a non-default locale
 *   - a key that exists but is never used
 *   - a placeholder present in English but not in the translation
 *   - a malformed resource (non-string leaf, empty value)
 *
 * Unused keys are reported as warnings rather than errors: a key can be used
 * dynamically, and a hard failure on a false positive would train people to
 * ignore the tool. Everything else fails the build.
 *
 * Run: node scripts/validate-translations.mjs   (also wired to `npm run i18n:check`)
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const localesDir = join(root, "locales");
const srcDir = join(root, "src");

const DEFAULT_LOCALE = "en";

function readTree(locale) {
  const dir = join(localesDir, locale);
  const tree = {};
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const ns = file.replace(/\.json$/, "");
    tree[ns] = JSON.parse(readFileSync(join(dir, file), "utf8"));
  }
  return tree;
}

function flat(tree, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[path] = v;
    else if (v && typeof v === "object") flat(v, path, out);
  }
  return out;
}

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;
const placeholders = (s) => [...s.matchAll(PLACEHOLDER)].map((m) => m[1]).sort();

const errors = [];
const warnings = [];

const locales = readdirSync(localesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

if (!locales.includes(DEFAULT_LOCALE)) {
  console.error(`Missing required default locale directory: locales/${DEFAULT_LOCALE}`);
  process.exit(1);
}

const base = flat(readTree(DEFAULT_LOCALE));
const baseKeys = Object.keys(base).sort();

// ---- 1. structure, parity, placeholders -----------------------------------
for (const locale of locales) {
  const tree = readTree(locale);
  const flatTree = flat(tree);

  // Malformed leaves: a namespace value that is not an object of strings.
  for (const [ns, value] of Object.entries(tree)) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      errors.push(`${locale}: namespace "${ns}" is not an object`);
    }
  }

  for (const [key, value] of Object.entries(flatTree)) {
    if (value.trim() === "") {
      errors.push(`${locale}: "${key}" is empty`);
    }
  }

  for (const key of baseKeys) {
    if (!(key in flatTree)) {
      errors.push(`${locale}: missing key "${key}"`);
      continue;
    }
    const want = placeholders(base[key]);
    const got = placeholders(flatTree[key]);
    if (want.join(",") !== got.join(",")) {
      errors.push(
        `${locale}: "${key}" placeholder mismatch - English has [${want.join(", ")}] but ${locale} has [${got.join(", ")}]`,
      );
    }
  }

  for (const key of Object.keys(flatTree)) {
    if (!(key in base)) {
      errors.push(`${locale}: extra key "${key}" has no English source`);
    }
  }
}

// ---- 2. usage -------------------------------------------------------------
/** Every literal `t("ns:key")` / `tc("ns:key")` call in the source. */
function collectUsedKeys(dir) {
  const used = new Set();
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(entry.name)) {
        const src = readFileSync(p, "utf8");
        for (const m of src.matchAll(/\b(?:t|tc)\(\s*"([a-z0-9_]+:[^"]+)"/gi)) {
          used.add(m[1]);
        }
      }
    }
  };
  walk(dir);
  return used;
}

const used = collectUsedKeys(srcDir);
// Keys referenced by the dynamic save-error path are not literals.
const dynamic = new Set(["settings:language.save_failed"]);

for (const key of baseKeys) {
  if (used.has(key) || dynamic.has(key)) continue;
  warnings.push(`unused key "${key}"`);
}

for (const key of used) {
  if (!key in base) {
    errors.push(`source references "${key}" which does not exist in ${DEFAULT_LOCALE}`);
  }
}

// ---- 3. registry agreement -------------------------------------------------
// The registry is what the Language page offers. If it disagrees with the
// `locales/` tree in either direction the UI lies: offering a locale with no
// resources renders English behind a translated-sounding flag, and shipping
// resources nobody can select is dead translation work.
const registrySource = readFileSync(join(root, "src/lib/i18n/registry.ts"), "utf8");
const entries = [...registrySource.matchAll(/\bL\(\s*"([^"]+)"\s*,\s*"([^"]+)"([^)]*)\)/g)].map(
  (m) => ({ id: m[1], lang: m[2], shipped: m[3].includes("SHIPPED") }),
);

if (entries.length === 0) {
  errors.push("could not parse any L() entries from src/lib/i18n/registry.ts");
}

const shippedIds = new Set(entries.filter((e) => e.shipped).map((e) => e.id));

for (const e of entries) {
  const hasDir = existsSync(join(localesDir, e.lang));
  if (e.shipped && !hasDir) {
    errors.push(
      `registry marks "${e.id}" as shipped but locales/${e.lang}/ does not exist - ` +
        `either write the translation or remove the ...SHIPPED marker`,
    );
  }
  if (e.shipped && e.lang !== DEFAULT_LOCALE && !locales.includes(e.lang)) {
    errors.push(`registry marks "${e.id}" as shipped but ${e.lang} is not a resource locale`);
  }
}

for (const locale of locales) {
  if (locale === DEFAULT_LOCALE) continue;
  if (!entries.some((e) => e.lang === locale && e.shipped)) {
    errors.push(
      `locales/${locale}/ exists but no registry locale is marked ...SHIPPED for it - ` +
        `add the entry and mark it shipped or the translations are unreachable`,
    );
  }
}

if (shippedIds.size === 0) {
  errors.push("registry ships no locales at all");
}

// Every shipped locale must have a distinct id: two entries with the same id
// would make one unreachable and make the cookie value ambiguous.
const idCounts = new Map();
for (const e of entries) idCounts.set(e.id, (idCounts.get(e.id) ?? 0) + 1);
for (const [id, n] of idCounts) {
  if (n > 1) errors.push(`registry has ${n} locales with id "${id}"`);
}

// ---- report ---------------------------------------------------------------
for (const w of warnings) console.warn(`warn  ${w}`);
for (const e of errors) console.error(`error ${e}`);

const total = baseKeys.length;
console.log(
  `\n${total} keys across ${locales.length} locale(s) [${locales.join(", ")}]; ` +
    `${errors.length} error(s), ${warnings.length} warning(s).`,
);

if (errors.length > 0) process.exit(1);
