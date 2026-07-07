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

// Render an inline SVG at a fixed display size regardless of its own attributes.
function sized(svg) {
  return svg.replace(/<svg\b[^>]*>/, (tag) =>
    tag.replace(/\s(width|height)="[^"]*"/g, "").replace("<svg", '<svg width="48" height="48"'),
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
        `<td>${sized(ref)}</td><td>${sized(fixed)}</td></tr>`,
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
  svg { display: block; margin: 0 auto; color: #111; }
  .sub { color: #888; font-weight: 400; }
</style></head><body>
<h1>Library SVG vs font glyph</h1>
<p class="hint">Each icon shown twice: <b>left</b> is the SVG that ships in <code>icons/</code> (renders as designed in the browser); <b>right</b> is the geometry-repaired glyph that Zulip's SVG-to-font build produces. They should look identical. Only the ${rows.length} icons that needed a stroke or fill-rule repair are shown; the other ${files.length - rows.length} are unchanged by normalization.</p>
<table>
<tr><th class="name">icon</th><th>reference<br><span class="sub">library / browser</span></th><th>font glyph<br><span class="sub">Inkscape-fixed</span></th></tr>
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
