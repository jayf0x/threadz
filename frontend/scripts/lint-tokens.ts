#!/usr/bin/env bun
// Drift guardrail: fails when a component reaches past the token layer for a
// raw color instead of a `var(--...)` / Tailwind token class. Themes are the
// one place raw values belong, so src/themes/ is exempt. A line that has a
// legitimate one-off raw color (a decorative gradient, say) can opt out with
// a trailing `// threadz-allow-raw-color` comment.
//
// This is the "design tokens as AI guardrails" pattern: a build-time check
// catches vibe-coding color drift on every commit, instead of relying on
// remembering to look during review.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SRC = join(ROOT, "src");
const EXEMPT_DIRS = [join(SRC, "themes")];
const SCAN_EXTENSIONS = [".ts", ".tsx", ".css"];
const ALLOW_MARKER = "threadz-allow-raw-color";

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/;
// `hsl(var(--x))` and friends read a token, which is the point; only literal channels are drift.
const FUNC_COLOR_RE = /\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\((?!\s*(?:from\s+)?var\()/;
const ARBITRARY_CLASS_RE =
  /\b(?:bg|text|border|ring|fill|stroke|from|via|to|shadow|outline|decoration|accent|caret|divide)-\[(#|rgb|hsl|oklch)/;

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (EXEMPT_DIRS.some((d) => full.startsWith(d))) continue;
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, files);
    else if (SCAN_EXTENSIONS.includes(full.slice(full.lastIndexOf(".")))) files.push(full);
  }
  return files;
}

const offenders: { file: string; line: number; text: string }[] = [];

for (const file of walk(SRC)) {
  const lines = readFileSync(file, "utf-8").split("\n");
  lines.forEach((line, i) => {
    if (line.includes(ALLOW_MARKER)) return;
    // `var(--foo)` and CSS variable *declarations* (`--foo: ...`) are fine —
    // only flag a color literal used directly as a value.
    const withoutVarRefs = line.replace(/var\(--[\w-]+\)/g, "");
    if (HEX_RE.test(withoutVarRefs) || FUNC_COLOR_RE.test(line) || ARBITRARY_CLASS_RE.test(line)) {
      offenders.push({ file: relative(ROOT, file), line: i + 1, text: line.trim() });
    }
  });
}

if (offenders.length > 0) {
  console.error(`lint:tokens — ${offenders.length} raw color literal(s) outside src/themes/:\n`);
  for (const o of offenders) console.error(`  ${o.file}:${o.line}  ${o.text}`);
  console.error(`\nUse a token (var(--primary), bg-primary, ...) or add "// ${ALLOW_MARKER}" if intentional.`);
  process.exit(1);
}

console.log("lint:tokens — clean, no raw colors outside src/themes/.");
