// Generate a self-contained comparison page: for every icon whose font glyph
// differs from its library SVG (the ones with strokes / evenodd fills that
// needed a geometry repair), show the two side by side plus a computed pixel
// diff. Every SVG is inlined so the page is a single file with no external
// dependencies — safe to commit and serve via GitHub Pages.
//
// The match column rasterizes both SVGs in the browser and reports pixel
// accuracy over the icon's footprint (the transparent background is ignored, so
// the number reflects the shapes, not the empty canvas). A control row at the
// top (an icon vs its mirror image) scores low, so a viewer can trust that a
// ~100% real row means genuinely identical, not a broken measure.
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

// Wrap the SVG's contents in a horizontal-mirror transform — used to synthesize
// a guaranteed-different "control" glyph.
function mirror(svg) {
  return unsized(svg)
    .replace(/(<svg\b[^>]*>)/, '$1<g transform="translate(16,0) scale(-1,1)">')
    .replace(/<\/svg>/, "</g></svg>");
}

function row(name, refSvg, fixSvg, isControl = false) {
  const cls = isControl ? "name control" : "name";
  const label = isControl ? `${name} <span class="tag">control</span>` : name;
  return (
    `<tr><td class="${cls}">${label}</td>` +
    `<td><div class="cell">${refSvg}</div></td>` +
    `<td><div class="cell">${fixSvg}</div></td>` +
    `<td><div class="cell matchcell"><span class="pct">…</span>` +
    `<div class="src ref" hidden>${refSvg}</div>` +
    `<div class="src fix" hidden>${fixSvg}</div></div></td></tr>`
  );
}

async function main() {
  const files = (await readdir(REF_DIR)).filter((f) => f.endsWith(".svg")).sort();
  const rows = [];

  // Control row first: a real, obvious difference for calibration.
  const control = unsized(await readFile(`${FIXED_DIR}/send-visible.svg`, "utf8"));
  rows.push(row("send-visible", control, mirror(control), true));

  let compared = 0;
  for (const file of files) {
    const ref = await readFile(`${REF_DIR}/${file}`, "utf8");
    const fixed = await readFile(`${FIXED_DIR}/${file}`, "utf8");
    if (ref.trim() === fixed.trim()) continue; // identical → nothing to compare
    rows.push(row(file.replace(/\.svg$/, ""), unsized(ref), unsized(fixed)));
    compared++;
  }

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>zulip-icons — library vs font glyph</title>
<style>
  body { margin: 0; background: #fff; color: #111; font-family: system-ui, sans-serif; padding: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p.hint { color: #666; font-size: 13px; max-width: 660px; margin: 0 0 16px; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #e5e5e5; padding: 12px 20px; text-align: center; font-size: 12px; }
  th { background: #fafafa; font-weight: 600; }
  td.name { text-align: left; font-family: ui-monospace, monospace; color: #333; }
  td.control { background: #fff7ed; }
  .tag { display: inline-block; margin-left: 6px; padding: 1px 6px; border-radius: 8px; background: #fdba74; color: #7c2d12; font-size: 10px; font-family: system-ui, sans-serif; }
  .sub { color: #888; font-weight: 400; }
  .cell { position: relative; width: 64px; height: 64px; margin: 0 auto; }
  .cell svg { position: absolute; inset: 0; width: 64px; height: 64px; color: #111; }
  .matchcell { display: flex; align-items: center; justify-content: center; }
  .pct { font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .legend { font-size: 12px; color: #444; margin: 12px 0 0; }
</style></head><body>
<h1>Library SVG vs font glyph</h1>
<p class="hint">Each icon: <b>reference</b> is the SVG that ships in <code>icons/</code> (renders as designed in the browser); <b>font glyph</b> is the geometry-repaired version Zulip's SVG-to-font build produces; <b>match</b> is the pixel accuracy between the two, measured over the icon's footprint. They should be ~100%. The orange <b>control</b> row compares an icon to its mirror image, so it scores low — proof that the measure isn't just always reporting 100%. Only the ${compared} icons that needed a stroke or fill-rule repair are shown; the other ${files.length - compared} are byte-identical after normalization.</p>
<p class="legend">match % = share of the icon's pixels that agree (100% = identical). Antialiasing on edges keeps real matches a hair under 100%.</p>
<table>
<tr><th class="name">icon</th><th>reference<br><span class="sub">library / browser</span></th><th>font glyph<br><span class="sub">Inkscape-fixed</span></th><th>match<br><span class="sub">pixel accuracy</span></th></tr>
${rows.join("\n")}
</table>
<script>
const SIZE = 128;
function rasterize(svg) {
  return new Promise((resolve, reject) => {
    const clone = svg.cloneNode(true);
    clone.setAttribute("width", SIZE);
    clone.setAttribute("height", SIZE);
    const data = "data:image/svg+xml;charset=utf-8," +
      encodeURIComponent(new XMLSerializer().serializeToString(clone));
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = c.height = SIZE;
      const x = c.getContext("2d");
      x.drawImage(img, 0, 0, SIZE, SIZE);
      resolve(x.getImageData(0, 0, SIZE, SIZE));
    };
    img.onerror = reject;
    img.src = data;
  });
}
// Pixel accuracy over the icon footprint: 1 - sum|aA - aB| / sum(max(aA, aB)).
// Using alpha coverage makes it robust to antialiasing (partial-coverage edge
// pixels contribute proportionally), and dividing by the union mass ignores the
// shared transparent background instead of letting it inflate the score.
function accuracy(a, b) {
  let num = 0, den = 0;
  for (let i = 3; i < a.data.length; i += 4) {
    const aa = a.data[i], ba = b.data[i];
    num += Math.abs(aa - ba);
    den += Math.max(aa, ba);
  }
  return den === 0 ? 1 : 1 - num / den;
}
(async () => {
  for (const cell of document.querySelectorAll(".matchcell")) {
    const [a, b] = await Promise.all([
      rasterize(cell.querySelector(".ref svg")),
      rasterize(cell.querySelector(".fix svg")),
    ]);
    const pct = accuracy(a, b) * 100;
    const el = cell.querySelector(".pct");
    el.textContent = (pct >= 99.95 ? "100" : pct.toFixed(1)) + "%";
    el.style.color = pct >= 99.5 ? "#16a34a" : pct >= 95 ? "#ca8a04" : "#dc2626";
  }
})();
</script>
</body></html>
`;
  await writeFile("compare.html", html);
  console.log(`Wrote compare.html with ${compared} comparison rows + 1 control.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
