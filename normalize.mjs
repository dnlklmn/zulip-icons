// Derive font-ready glyphs from the library SVGs in icons/.
//
// The library SVGs (icons/*.svg) are tuned for standalone use in a browser:
// currentColor, a <title>/<desc> provenance note, and an adaptive <style>.
// Zulip's SVG-to-font conversion (webfonts-loader) wants the opposite — a
// stripped file with only <svg> + <path d>, black fill, no strokes, and no
// fill-rule="evenodd". This script applies the markup-level normalization and
// flags the two geometry problems that still need a real transform (Inkscape /
// picosvg): strokes and evenodd fills, which render fine in a browser but break
// font conversion.
//
// Usage: node normalize.mjs

import { readdir, readFile, writeFile, mkdir, rm } from "node:fs/promises";

const SRC_DIR = "icons";
const OUT_DIR = "build/glyphs";

function normalize(raw) {
  let svg = raw;

  // Drop everything the font converter doesn't want: the adaptive style and the
  // provenance note (that data lives in manifest.json, not the glyph).
  svg = svg
    .replace(/\s*<style>[\s\S]*?<\/style>/g, "")
    .replace(/\s*<title>[\s\S]*?<\/title>/g, "")
    .replace(/\s*<desc>[\s\S]*?<\/desc>/g, "");

  // Rebuild a minimal <svg> tag: xmlns + fixed 16x16 size + viewBox, nothing
  // else (drop class, fill="none", etc.). Preserve the source viewBox.
  const viewBox = (svg.match(/viewBox="([^"]*)"/) || [])[1] ?? "0 0 16 16";
  svg = svg.replace(
    /<svg\b[^>]*>/,
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="${viewBox}">`,
  );

  // Paths need no fill — it defaults to black, which is what the font wants.
  svg = svg.replace(/\s*fill="[^"]*"/g, "");

  // Collapse the blank lines left behind so the diff is about content.
  svg = svg.replace(/\n{2,}/g, "\n").trim() + "\n";
  return svg;
}

// Report the geometry issues that markup normalization can't fix.
function geometryIssues(svg) {
  const issues = [];
  if (/\bstroke(-width)?="/.test(svg)) issues.push("stroke");
  if (/fill-rule="evenodd"|clip-rule="evenodd"/.test(svg)) issues.push("evenodd");
  return issues;
}

async function main() {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const files = (await readdir(SRC_DIR)).filter((f) => f.endsWith(".svg")).sort();
  const needsGeometry = [];

  for (const file of files) {
    const raw = await readFile(`${SRC_DIR}/${file}`, "utf8");
    const glyph = normalize(raw);
    await writeFile(`${OUT_DIR}/${file}`, glyph);
    const issues = geometryIssues(glyph);
    if (issues.length) needsGeometry.push({ file, issues });
  }

  const clean = files.length - needsGeometry.length;
  console.log(`Normalized ${files.length} glyphs into ${OUT_DIR}/`);
  console.log(`  font-ready after markup strip: ${clean}`);
  console.log(`  still need a geometry pass:     ${needsGeometry.length}`);
  for (const { file, issues } of needsGeometry) {
    console.log(`    ${file.padEnd(26)} ${issues.join(", ")}`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
