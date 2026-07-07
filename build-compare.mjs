// Generate a self-contained comparison page: for every icon whose font glyph
// differs from its library SVG (the ones with strokes / evenodd fills that
// needed a geometry repair), show the two side by side. Every SVG is inlined so
// the page is a single file with no external dependencies — safe to commit and
// serve via GitHub Pages.
//
// Run after `node normalize.mjs && node fix-geometry.mjs`.
// Usage: node build-compare.mjs

import { readdir, readFile, writeFile } from "node:fs/promises";

const REF_DIR = "build/glyphs";        // library geometry (browser-correct)
const FIXED_DIR = "build/glyphs-fixed"; // font-ready geometry

// Strip the SVG's own width/height so CSS controls the display size.
function unsized(svg) {
  return svg.replace(/<svg\b[^>]*>/, (tag) =>
    tag.replace(/\s(width|height)="[^"]*"/g, ""),
  );
}

async function main() {
  const files = (await readdir(REF_DIR)).filter((f) => f.endsWith(".svg")).sort();
  const rows = [];
  for (const file of files) {
    const ref = await readFile(`${REF_DIR}/${file}`, "utf8");
    const fixed = await readFile(`${FIXED_DIR}/${file}`, "utf8");
    if (ref.trim() === fixed.trim()) continue; // identical → nothing to compare
    const name = file.replace(/\.svg$/, "");
    rows.push(
      `<tr><td class="name">${name}</td>` +
        `<td><div class="cell">${unsized(ref)}</div></td>` +
        `<td><div class="cell">${unsized(fixed)}</div></td>` +
        `<td><div class="cell overlay">` +
        `<div class="ref">${unsized(ref)}</div>` +
        `<div class="fix">${unsized(fixed)}</div></div></td></tr>`,
    );
  }

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>zulip-icons — library vs font glyph</title>
<style>
  body { margin: 0; background: #fff; color: #111; font-family: system-ui, sans-serif; padding: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p.hint { color: #666; font-size: 13px; max-width: 640px; margin: 0 0 20px; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #e5e5e5; padding: 12px 20px; text-align: center; font-size: 12px; }
  th { background: #fafafa; font-weight: 600; }
  td.name { text-align: left; font-family: ui-monospace, monospace; color: #333; }
  .sub { color: #888; font-weight: 400; }
  .cell { position: relative; width: 64px; height: 64px; margin: 0 auto; }
  .cell svg { position: absolute; inset: 0; width: 64px; height: 64px; color: #111; }
  /* Overlay: recolor each layer's rendered pixels via filter (preserves the
     shapes' own fills, strokes, and holes exactly), then superimpose at half
     opacity. Reference tints red, font glyph tints blue. Perfect alignment
     reads as flat purple; any red- or blue-only fringe is a real difference. */
  .overlay .ref, .overlay .fix { position: absolute; inset: 0; opacity: 0.55; }
  .overlay .ref svg { filter: invert(19%) sepia(85%) saturate(4000%) hue-rotate(329deg) brightness(95%); }
  .overlay .fix svg { filter: invert(24%) sepia(97%) saturate(2200%) hue-rotate(213deg) brightness(97%); }
  .legend { font-size: 12px; color: #444; margin: 14px 0 0; }
  .chip { display: inline-block; width: 11px; height: 11px; border-radius: 2px; vertical-align: -1px; margin: 0 3px 0 10px; }
</style></head><body>
<h1>Library SVG vs font glyph</h1>
<p class="hint">Each icon: <b>reference</b> is the SVG that ships in <code>icons/</code> (renders as designed in the browser); <b>font glyph</b> is the geometry-repaired version Zulip's SVG-to-font build produces; <b>overlay</b> superimposes the two. They should match. Only the ${rows.length} icons that needed a stroke or fill-rule repair are shown; the other ${files.length - rows.length} are byte-identical after normalization.</p>
<p class="legend">In the overlay column:
<span class="chip" style="background:#7c3aed"></span> purple = the two align (good) ·
<span class="chip" style="background:#e11d48"></span> red = only in the reference ·
<span class="chip" style="background:#2563eb"></span> blue = only in the font glyph</p>
<table>
<tr><th class="name">icon</th><th>reference<br><span class="sub">library / browser</span></th><th>font glyph<br><span class="sub">Inkscape-fixed</span></th><th>overlay<br><span class="sub">red vs blue</span></th></tr>
${rows.join("\n")}
</table>
</body></html>
`;
  await writeFile("compare.html", html);
  console.log(`Wrote compare.html with ${rows.length} comparison rows.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
