// Repair the glyphs that markup normalization can't fix: stroke-based icons and
// evenodd fills that break Zulip's SVG-to-font conversion. This shells out to
// Inkscape's CLI to run the same steps the icon docs describe by hand — Object
// to Path, Stroke to Path, and a boolean union/combine into a single path — then
// re-strips the file back to bare <svg> + <path d>.
//
// Requires Inkscape on PATH (or at the macOS app location). Only touches glyphs
// flagged by normalize.mjs; clean glyphs are copied through untouched.
//
// Usage: node fix-geometry.mjs

import { readdir, readFile, writeFile, mkdir, rm, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const IN_DIR = "build/glyphs";
const OUT_DIR = "build/glyphs-fixed";

// Prefer an absolute install we can confirm exists; fall back to PATH lookup.
function resolveInkscape() {
  const appPath = "/Applications/Inkscape.app/Contents/MacOS/inkscape";
  if (existsSync(appPath)) return appPath;
  try {
    execFileSync("inkscape", ["--version"], { stdio: "ignore" });
    return "inkscape";
  } catch {
    throw new Error("Inkscape not found in /Applications or on PATH.");
  }
}

function needsFix(svg) {
  return /\bstroke(-width)?="/.test(svg) || /(fill|clip)-rule="evenodd"/.test(svg);
}

// Re-minimize an Inkscape-saved file back to Zulip's clean form.
function restrip(svg) {
  const viewBox = (svg.match(/viewBox="([^"]*)"/) || [])[1] ?? "0 0 16 16";
  const paths = [...svg.matchAll(/<path\b[^>]*\bd="([^"]*)"[^>]*\/?>/g)].map(
    (m) => `<path d="${m[1]}"/>`,
  );
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="${viewBox}">\n` +
    paths.map((p) => `  ${p}`).join("\n") +
    `\n</svg>\n`
  );
}

async function main() {
  const inkscape = resolveInkscape();
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const files = (await readdir(IN_DIR)).filter((f) => f.endsWith(".svg")).sort();
  let fixed = 0;
  for (const file of files) {
    const inPath = `${IN_DIR}/${file}`;
    const outPath = `${OUT_DIR}/${file}`;
    const svg = await readFile(inPath, "utf8");
    if (!needsFix(svg)) {
      await copyFile(inPath, outPath);
      continue;
    }
    // Object to Path (shapes->paths), Stroke to Path (outline strokes), then
    // Union to merge overlaps resolving evenodd, and Combine into one path.
    await run(inkscape, [
      inPath,
      "--actions",
      "select-all;object-to-path;object-stroke-to-path;path-union;path-combine;export-plain-svg;export-overwrite;export-do",
      `--export-filename=${outPath}`,
    ]);
    const cleaned = restrip(await readFile(outPath, "utf8"));
    await writeFile(outPath, cleaned);
    fixed++;
    console.log(`  fixed ${file}`);
  }
  console.log(`\nFixed ${fixed} glyphs, copied ${files.length - fixed} clean.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
