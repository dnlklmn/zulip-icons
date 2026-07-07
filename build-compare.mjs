// Generate a self-contained comparison page: for every icon whose font glyph
// differs from its library SVG (the ones with strokes / evenodd fills that
// needed a geometry repair), show the two side by side plus a computed pixel
// diff. Every SVG is inlined so the page is a single file with no external
// dependencies — safe to commit and serve via GitHub Pages.
//
// The diff column rasterizes both SVGs in the browser and paints the icon
// silhouette gray with any differing pixels in magenta. A control row at the top
// (an icon vs its mirror image) is guaranteed to differ, so a viewer can trust
// that "no magenta" on the real rows means genuinely identical, not a broken diff.
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
    `<td><div class="cell diffcell"><canvas></canvas>` +
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
  .cell svg, .cell canvas { position: absolute; inset: 0; width: 64px; height: 64px; color: #111; }
  .legend { font-size: 12px; color: #444; margin: 12px 0 0; }
  .chip { display: inline-block; width: 11px; height: 11px; border-radius: 2px; vertical-align: -1px; margin: 0 3px 0 10px; }
</style></head><body>
<h1>Library SVG vs font glyph</h1>
<p class="hint">Each icon: <b>reference</b> is the SVG that ships in <code>icons/</code> (renders as designed in the browser); <b>font glyph</b> is the geometry-repaired version Zulip's SVG-to-font build produces; <b>diff</b> highlights any pixel that differs between the two. They should match, so the diff should show only the gray silhouette. The orange <b>control</b> row compares an icon to its mirror image — it must light up magenta, which proves the diff is working. Only the ${compared} icons that needed a stroke or fill-rule repair are shown; the other ${files.length - compared} are byte-identical after normalization.</p>
<p class="legend">
<span class="chip" style="background:#d2d2d6"></span> gray = the icon shape ·
<span class="chip" style="background:#ff00a0"></span> magenta = pixels that differ</p>
<table>
<tr><th class="name">icon</th><th>reference<br><span class="sub">library / browser</span></th><th>font glyph<br><span class="sub">Inkscape-fixed</span></th><th>diff<br><span class="sub">magenta = differs</span></th></tr>
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
(async () => {
  for (const cell of document.querySelectorAll(".diffcell")) {
    const refSvg = cell.querySelector(".ref svg");
    const fixSvg = cell.querySelector(".fix svg");
    const [a, b] = await Promise.all([rasterize(refSvg), rasterize(fixSvg)]);
    const canvas = cell.querySelector("canvas");
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    const out = ctx.createImageData(SIZE, SIZE);
    for (let i = 0; i < a.data.length; i += 4) {
      const aa = a.data[i + 3];        // reference coverage (alpha)
      const ba = b.data[i + 3];        // font-glyph coverage
      if (Math.abs(aa - ba) > 60) {    // covered by one but not the other
        out.data[i] = 255; out.data[i + 1] = 0; out.data[i + 2] = 160; out.data[i + 3] = 255;
      } else if (Math.max(aa, ba) > 40) {
        out.data[i] = 210; out.data[i + 1] = 210; out.data[i + 2] = 214; out.data[i + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
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
