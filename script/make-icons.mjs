// Draws the Gyrelab icon (a gyre: a blue spiral) and writes src/icon.svg,
// src/app-icon.png, and src/favicon.ico.
//
//    bun script/make-icons.mjs [previewdir]
//
// With a directory, writes previews there instead of into src/.
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";

const BLUE = "#2f7de1";
const EDGE = "#174c9c";

// An Archimedean spiral, with a darker edge so it holds up small.
function spiral({ turns, inner, width, outline }) {
  const pts = [];
  const steps = 720;
  const end = turns * 2 * Math.PI;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * end;
    const r = inner + (0.5 - inner - width / 2 - outline) * (t / end);
    pts.push([0.5 + r * Math.cos(t - Math.PI / 2), 0.5 + r * Math.sin(t - Math.PI / 2)]);
  }
  const d = pts
    .map(([x, y], i) => `${i ? "L" : "M"}${(x * 100).toFixed(2)} ${(y * 100).toFixed(2)}`)
    .join("");
  const w = width * 100;
  const o = outline * 100;
  const stroke = (color, width) =>
    `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
  return stroke(EDGE, w + 2 * o) + stroke(BLUE, w);
}

function svg(size, { background = null, inset = 0, ...shape }) {
  const bg = background ? `<rect width="100" height="100" fill="${background}"/>` : "";
  const scale = 1 - 2 * inset;
  const body = `<g transform="translate(${inset * 100} ${inset * 100}) scale(${scale})">${spiral(shape)}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}">${bg}${body}</svg>`;
}

// Small sizes get fewer, fatter turns, so the spiral still reads.
const LARGE = { turns: 2.2, inner: 0.07, width: 0.075, outline: 0.012 };
const SMALL = { turns: 1.3, inner: 0.12, width: 0.12, outline: 0.015 };

async function render(page, markup, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0">${markup}</body></html>`);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

// An .ico holding PNGs, which every current browser understands.
function ico(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.data)]);
}

const out = process.argv[2] ?? new URL("../src/", import.meta.url).pathname;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();

writeFileSync(`${out}/icon.svg`, svg(512, LARGE));
// The app icon is opaque: iOS fills transparency with black.
// Inset, since iOS rounds the corners off.
writeFileSync(
  `${out}/app-icon.png`,
  await render(page, svg(512, { background: "#f6f1e3", inset: 0.1, ...LARGE }), 512),
);
const favicon = [];
for (const size of [16, 32, 48]) {
  favicon.push({ size, data: await render(page, svg(size, SMALL), size) });
  if (process.argv[2]) writeFileSync(`${out}/favicon-${size}.png`, favicon.at(-1).data);
}
writeFileSync(`${out}/favicon.ico`, ico(favicon));
await browser.close();
console.log(`Wrote icon.svg, app-icon.png, and favicon.ico to ${out}`);
