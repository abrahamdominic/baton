#!/usr/bin/env node
/**
 * Translation validator (lan.md §18, §32).
 *
 * Catches the failure modes that otherwise ship silently:
 *   - a key missing from a non-default locale
 *   - a key that exists but is never referenced by any call site
 *   - a placeholder present in English but not in the translation
 *   - a malformed resource (non-string leaf, empty value)
 *   - a duplicate key inside a resource file, which `JSON.parse` silently
 *     collapses to the last occurrence
 *   - a `t("ns:key")` in the source that no resource defines
 *   - registry entries that disagree with the `locales/` tree
 *
 * Missing keys, broken references, duplicates and structural problems are
 * errors and fail the command. Unused keys are warnings: a key can legitimately
 * be reached dynamically, and a hard failure on a false positive trains people
 * to ignore the tool. `--strict` promotes warnings to errors for CI.
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

/**
 * The public lookup key separator.
 *
 * Must match `toFlat()` in `src/lib/i18n/bundles.ts`, because that is what every
 * `t("namespace:key")` call site resolves against. An earlier version of this
 * script flattened with "." while the runtime used ":", so every usage lookup
 * missed: all 436 keys looked unused and a key referenced in source but missing
 * from English was never reported. Do not "simplify" this back to ".".
 */
const SEP = ":";

const strict = process.argv.includes("--strict");

function readTree(locale) {
  const dir = join(localesDir, locale);
  const tree = {};
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const ns = file.replace(/\.json$/, "");
    tree[ns] = JSON.parse(readFileSync(join(dir, file), "utf8"));
  }
  return tree;
}

/** `namespace:key.path` -> value. */
function flat(tree) {
  const out = {};
  for (const [ns, nsTree] of Object.entries(tree)) {
    walk(nsTree, "", (path, value) => {
      out[`${ns}${SEP}${path}`] = value;
    });
  }
  return out;
}

function walk(node, prefix, emit) {
  for (const [k, v] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") emit(path, v);
    else if (v && typeof v === "object") walk(v, path, emit);
  }
}

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;
const placeholders = (s) => [...s.matchAll(PLACEHOLDER)].map((m) => m[1]).sort();

/**
 * Finds duplicate object keys in a JSON document.
 *
 * `JSON.parse` keeps the last occurrence and reports nothing, so a file with
 * `"save"` declared twice parses cleanly and ships whichever copy happened to be
 * second. That is exactly the class of bug this validator exists to catch, so
 * the raw text is scanned instead of trusting the parse.
 */
function findDuplicateKeys(source) {
  const dupes = new Map();
  // Tracks key names per nesting level so a key repeated in a sibling object is
  // reported at the right depth rather than globally.
  const stack = [{ keys: new Set() }];
  let i = 0;

  const readString = () => {
    let out = "";
    i++; // opening quote
    while (i < source.length) {
      const ch = source[i];
      if (ch === "\\") {
        out += source[i] + source[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') {
        i++;
        return out;
      }
      out += ch;
      i++;
    }
    return out;
  };

  while (i < source.length) {
    const ch = source[i];
    if (ch === "{") {
      stack.push({ keys: new Set() });
      i++;
      continue;
    }
    if (ch === "}") {
      if (stack.length > 1) stack.pop();
      i++;
      continue;
    }
    if (ch === '"') {
      const key = readString();
      // Look ahead past whitespace for the ':' that makes this a key rather than
      // a string value.
      let j = i;
      while (j < source.length && /\s/.test(source[j])) j++;
      if (source[j] === ":") {
        const frame = stack[stack.length - 1];
        if (frame.keys.has(key)) {
          dupes.set(key, (dupes.get(key) ?? 0) + 1);
        } else {
          frame.keys.add(key);
        }
      }
      continue;
    }
    i++;
  }
  return dupes;
}

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

/** The namespaces that exist on disk, used to recognise a key in source. */
const NAMESPACES = readdirSync(join(localesDir, DEFAULT_LOCALE))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""));

// ---- 0. duplicates inside the resource files -------------------------------
for (const locale of locales) {
  const dir = join(localesDir, locale);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const dupes = findDuplicateKeys(readFileSync(join(dir, file), "utf8"));
    for (const [key, count] of dupes) {
      errors.push(
        `${locale}/${file}: duplicate key "${key}" declared ${count + 1} times - ` +
          `JSON.parse keeps only the last one, so the file does not do what it looks like`,
      );
    }
  }
}

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
    if (typeof value !== "string" || value.trim() === "") {
      errors.push(`${locale}: "${key}" is empty or not a string`);
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
/**
 * Every translation key the source names.
 *
 * Two passes, because a key can reach `t()` two different ways:
 *
 *  1. Any string literal in a source file that looks like `known-namespace:key`.
 *     This is deliberately broader than "a direct argument to `t()`", because
 *     table-driven components - the landing page, the state matrix, the
 *     simulator - hold their keys in a module-level array of `{ titleKey,
 *     bodyKey }` records and only call `t()` on a loop variable. Matching `t(`
 *     alone reported every one of those keys as dead.
 *  2. Template-literal keys, whose namespace and prefix are static while the
 *     tail is computed at runtime (`t(`marketing:sim_${n}_tab`)`). These cannot be
 *     enumerated, so a prefix match stands in for them.
 *
 * A key that appears nowhere in the source is still reported, which is the only
 * thing this check exists to catch.
 */
function collectUsedKeys(dir) {
  const used = new Map();
  /** Prefixes from `t(`ns:part_${x}`)` - every key starting with `ns:part_` counts as used. */
  const prefixes = new Map();
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(entry.name)) {
        // Tests build synthetic bundles out of made-up keys, and a key used only
        // by a test is not used by the product. Scanning them produces errors
        // that say nothing about the shipped UI.
        if (/\.(test|dbtest|spec)\.[tj]sx?$/.test(entry.name)) continue;
        const src = readFileSync(p, "utf8");
        const namespaced = new RegExp(
          `["'\`]((?:${NAMESPACES.join("|")}):[a-z0-9_][a-z0-9_.-]*)["'\`]`,
          "g",
        );
        for (const m of src.matchAll(namespaced)) {
          if (!used.has(m[1])) used.set(m[1], p);
        }
        // A template-literal key has a static namespace+prefix and a dynamic
        // tail (e.g. `language:group_${group}`). Any key under that prefix
        // satisfies it. The static part may be empty when the interpolation
        // starts immediately after the namespace (`billing:${kind}_${value}`
        // in lib/i18n/billing-label.ts), and the translator is often reached
        // through an injected `Translator`, so accept its name too.
        for (const m of src.matchAll(/\b(?:t|tc|translate|tc_)\(\s*`([a-z0-9_-]+:[a-z0-9_-]*)\$\{/gi)) {
          if (!prefixes.has(m[1])) prefixes.set(m[1], p);
        }
      }
    }
  };
  walk(dir);
  return { used, prefixes };
}

const { used, prefixes: usedPrefixes } = collectUsedKeys(srcDir);

/**
 * CLDR plural categories a resource file may define for one logical key.
 *
 * `tc("dashboard:pr_count", n)` resolves `pr_count_one` / `pr_count_other` at
 * runtime, so the suffixed keys satisfy the base name and the base name is not
 * itself expected to exist.
 */
const PLURAL_SUFFIXES = ["one", "other", "zero", "two", "few", "many"];

/** True when `key` is defined directly, or as the base of a plural group. */
function definesKey(tree, key) {
  if (tree[key] !== undefined) return true;
  return PLURAL_SUFFIXES.some((c) => tree[`${key}_${c}`] !== undefined);
}

const coveredByPrefix = (key) => {
  for (const p of usedPrefixes.keys()) if (key.startsWith(p)) return true;
  return false;
};

/**
 * Strips a trailing CLDR category from a flattened key, if it has one.
 *
 * `intelligence:owners_commits_other` -> `intelligence:owners_commits`.
 * `intelligence:collected_ago` -> unchanged, because `ago` is not a category.
 */
function pluralBase(key) {
  const i = key.lastIndexOf("_");
  if (i === -1) return key;
  return PLURAL_SUFFIXES.includes(key.slice(i + 1)) ? key.slice(0, i) : key;
}

/**
 * True when the source reaches `key`, directly or through a plural group.
 *
 * A page never names a plural variant; it names the base key and passes a
 * `count` (`t("intelligence:owners_commits", { count })`). The runtime expands
 * the base into `key_other`/`key_one` on demand, so a variant the source never
 * mentions is still live. Checking `used.has(key)` alone reported every plural
 * key in the app as dead the moment it was wired up.
 *
 * The reverse also holds: naming a variant literally (`key_other`) proves the
 * group is used, so all of its siblings count too.
 */
function isUsed(key) {
  if (used.has(key) || coveredByPrefix(key)) return true;
  const base = pluralBase(key);
  return base !== key && used.has(base);
}

// Keys referenced through a runtime-computed path, not a literal.
const dynamic = new Set([
  // The provider stores a key and the Language page renders it with `t(saveError)`.
  "language:save_failed",
]);

for (const key of baseKeys) {
  if (isUsed(key) || dynamic.has(key)) continue;
  warnings.push(`unused key "${key}"`);
}

for (const [key, file] of used) {
  if (!definesKey(base, key)) {
    errors.push(`source references "${key}" (${file.replace(root + "/", "")}) which does not exist in ${DEFAULT_LOCALE}`);
  }
}

for (const [prefix, file] of usedPrefixes) {
  if (Object.keys(base).some((k) => k.startsWith(prefix))) continue;
  errors.push(
    `source builds the key "${prefix}…" dynamically (${file.replace(root + "/", "")}) but no resource matches that prefix`,
  );
}

// Dynamic keys must exist too, otherwise the runtime silently renders nothing.
for (const key of dynamic) {
  if (!definesKey(base, key)) errors.push(`dynamic key "${key}" does not exist in ${DEFAULT_LOCALE}`);
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
if (strict && warnings.length > 0) {
  console.error(`--strict: ${warnings.length} warning(s) treated as failure.`);
  process.exit(1);
}
