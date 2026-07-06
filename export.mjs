// Export the Zulip icon set from Figma as clean SVGs, carrying each icon's
// Figma component Description into the SVG code as <title>/<desc>, plus a
// manifest.json and a rendered README table.
//
// Requires a Figma personal access token with read access to the file. Provide
// it as FIGMA_TOKEN in the environment or in a .env.local file next to this
// script (FIGMA_TOKEN=figd_...). See README for how to generate one.
//
// Usage: npm run export

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

// The Figma file and the "Icon" component set inside it.
const FILE_KEY = "1hYf10BhTLP0aBzbpA6TyF";
const SET_NODE_ID = "1:599";
const ICON_DIR = "icons";

// Icons paint with `currentColor` so consumers control the color. On their own
// (e.g. embedded in the README via <img>) that resolves via this scoped root
// color, which flips with the viewer's color scheme so icons stay visible on
// both light and dark GitHub. The `.zi` class keeps it from leaking to other
// SVGs when a file is inlined; consumers can override it or drop the <style>.
const ADAPTIVE_STYLE =
  "<style>.zi{color:#3f3f46}" +
  "@media(prefers-color-scheme:dark){.zi{color:#d4d4d8}}</style>";

// --- Token loading ---------------------------------------------------------

async function loadToken() {
  if (process.env.FIGMA_TOKEN) {
    return process.env.FIGMA_TOKEN.trim();
  }
  if (existsSync(".env.local")) {
    const text = await readFile(".env.local", "utf8");
    const match = text.match(/^\s*FIGMA_TOKEN\s*=\s*(.+)\s*$/m);
    if (match) {
      return match[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  throw new Error(
    "No Figma token found. Set FIGMA_TOKEN in the environment or in .env.local",
  );
}

// --- Figma REST helpers ----------------------------------------------------

async function figma(token, path) {
  const res = await fetch(`https://api.figma.com/v1/${path}`, {
    headers: { "X-Figma-Token": token },
  });
  if (!res.ok) {
    throw new Error(`Figma API ${path} -> ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// The component set's direct children are the icon variants. The same node
// response carries a `components` map with each variant's Description — this is
// the only source that works for local (unpublished) components; the
// /v1/files/:key/components endpoint only lists library-published components.
async function fetchVariants(token) {
  const data = await figma(token, `files/${FILE_KEY}/nodes?ids=${SET_NODE_ID}`);
  const node = data.nodes[SET_NODE_ID];
  const doc = node?.document;
  if (!doc?.children) {
    throw new Error(`Component set ${SET_NODE_ID} has no children`);
  }
  const descriptions = new Map(
    Object.entries(node.components ?? {}).map(([id, component]) => [
      id,
      (component.description ?? "").trim(),
    ]),
  );
  const variants = doc.children
    .filter((child) => child.type === "COMPONENT")
    .map((child) => ({ nodeId: child.id, variantName: child.name }));
  return { variants, descriptions };
}

// Batch-export the variants as isolated SVGs (transparent, no parent chrome).
async function fetchSvgUrls(token, nodeIds) {
  const ids = nodeIds.join(",");
  const data = await figma(
    token,
    `images/${FILE_KEY}?ids=${encodeURIComponent(ids)}&format=svg`,
  );
  return data.images;
}

// --- SVG cleaning ----------------------------------------------------------

function escapeXml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Turn "Icon=Plus Square" / raw "Plus Square" into "plus-square".
function toSlug(variantName) {
  return variantName
    .replace(/^Icon=/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Normalize a raw Figma SVG: drop fixed size, hardcoded colors, and stray ids;
// inject the name and description as <title>/<desc> so provenance travels with
// the file.
function cleanSvg(raw, { slug, description }) {
  let svg = raw.trim();

  // Operate on the opening <svg ...> tag: keep viewBox, drop width/height, and
  // tag it with the `.zi` class the adaptive style targets.
  svg = svg.replace(/<svg\b([^>]*)>/, (_match, attrs) => {
    const kept = attrs
      .replace(/\s(width|height)="[^"]*"/g, "")
      .replace(/\sid="[^"]*"/g, "");
    return `<svg class="zi"${kept}>`;
  });

  // Strip Figma's layer-name ids and swap every concrete paint (hex, "white",
  // "black", rgb(), …) for currentColor so icons inherit the surrounding text
  // color. Leaves "none", existing "currentColor", and gradient url() refs.
  svg = svg
    .replace(/\sid="[^"]*"/g, "")
    .replace(
      /(fill|stroke)="(?!none|currentColor|url\()[^"]*"/g,
      '$1="currentColor"',
    );

  // Inject the adaptive style and the note as the first children of <svg>.
  const note =
    `\n  ${ADAPTIVE_STYLE}` +
    `\n  <title>${escapeXml(slug)}</title>` +
    (description ? `\n  <desc>${escapeXml(description)}</desc>` : "");
  svg = svg.replace(/(<svg\b[^>]*>)/, `$1${note}`);

  return svg.trim() + "\n";
}

// --- README ----------------------------------------------------------------

function renderReadme(icons) {
  const rows = icons
    .map(
      (icon) =>
        `| <img src="${ICON_DIR}/${icon.slug}.svg" width="24" height="24" alt="${icon.slug}"> ` +
        `| \`${icon.slug}\` | ${icon.description || "—"} |`,
    )
    .join("\n");

  return `# Zulip icons

${icons.length} icons exported from Figma. Each SVG carries its source name and
description (where available) as \`<title>\`/\`<desc>\` in the file itself; the
same data is in [\`manifest.json\`](manifest.json).

Regenerate with \`npm run export\` (needs a Figma token — see below).

| Icon | Name | Description |
| :--: | ---- | ----------- |
${rows}

## Regenerating

1. Create a Figma personal access token (Settings → Security → Personal access
   tokens) with file read access.
2. \`echo 'FIGMA_TOKEN=figd_...' > .env.local\`
3. \`npm run export\`
`;
}

// --- Main ------------------------------------------------------------------

async function main() {
  const token = await loadToken();

  console.log("Fetching variants and descriptions…");
  const { variants, descriptions } = await fetchVariants(token);
  const describedCount = [...descriptions.values()].filter(Boolean).length;
  console.log(
    `Found ${variants.length} icon variants (${describedCount} with descriptions).`,
  );

  console.log("Requesting SVG exports…");
  const urls = await fetchSvgUrls(
    token,
    variants.map((v) => v.nodeId),
  );

  await mkdir(ICON_DIR, { recursive: true });

  const icons = [];
  for (const { nodeId, variantName } of variants) {
    const slug = toSlug(variantName);
    const description = descriptions.get(nodeId) ?? "";
    const url = urls[nodeId];
    if (!url) {
      console.warn(`  ! no export URL for ${slug} (${nodeId}), skipping`);
      continue;
    }
    const raw = await (await fetch(url)).text();
    const svg = cleanSvg(raw, { slug, description });
    await writeFile(`${ICON_DIR}/${slug}.svg`, svg);
    icons.push({ slug, nodeId, variantName, description });
    console.log(`  ✓ ${slug}${description ? "  — " + description : ""}`);
  }

  icons.sort((a, b) => a.slug.localeCompare(b.slug));

  await writeFile("manifest.json", JSON.stringify(icons, null, 2) + "\n");
  await writeFile("README.md", renderReadme(icons));

  console.log(`\nWrote ${icons.length} icons, manifest.json, and README.md.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
