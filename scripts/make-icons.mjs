// Generates PNG favicon / apple-touch-icon assets from src/app/icon.svg.
// Usage: node scripts/make-icons.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(resolve(root, "src/app/icon.svg"));

const outDir = resolve(root, "public");
mkdirSync(outDir, { recursive: true });

const targets = [
  { file: "favicon-32.png", size: 32 },
  { file: "favicon-16.png", size: 16 },
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
];

for (const t of targets) {
  const buf = await sharp(svg).resize(t.size, t.size).png().toBuffer();
  writeFileSync(resolve(outDir, t.file), buf);
  console.log("wrote", `public/${t.file}`);
}

// apple touch icon (rounded corners preserved) — apple prefers opaque PNG.
const apple = await sharp(svg).resize(180, 180).png().toBuffer();
writeFileSync(resolve(outDir, "apple-touch-icon.png"), apple);
console.log("wrote public/apple-touch-icon.png");

// Also the app-dir copy Next.js serves at /apple-icon.png automatically.
mkdirSync(resolve(root, "src/app"), { recursive: true });
writeFileSync(resolve(root, "src/app/apple-icon.png"), apple);
console.log("wrote src/app/apple-icon.png");