#!/usr/bin/env node
/**
 * Redraw the Ziit badge SVG in the shields.io "for-the-badge" style.
 *
 * Why redraw instead of just swapping font-family in the original SVG:
 *   1. Ziit returns a shields "flat" badge (20px tall, proportional font), while the
 *      other badges in the README are "for-the-badge" (28px tall, bold value), so the
 *      styles don't match side by side.
 *   2. Ziit declares font-family="Verdana,DejaVu Sans,sans-serif", but none of those
 *      exist on GitHub's ubuntu-24.04 runner (its apt manifest only ships
 *      fonts-noto-color-emoji), so rsvg-convert falls back to a generic font.
 *      That is the actual reason the glyphs look bad.
 *   3. librsvg ignores textLength (measured: changing 838 to 400 / 1200 renders
 *      pixel-identical output), so the original SVG's precise positioning never
 *      applied under rsvg in the first place.
 *
 * Approach: pull "label: value" out of the Ziit SVG and re-lay it out using shields'
 * real geometry, measured from the live shields.io templates:
 *   height 28; 12px padding on each side of the text; the two rectangles touch;
 *   label #555, value #007ec6; text baseline y = 1.75 * font-size
 *   (the shields template is font-size 100 / y 175 at 10x scale).
 *
 * Font is JetBrains Mono: monospace, a fixed 0.6em per character (measured across
 * 4 weights, all 600/1000), so text width is computable exactly without textLength
 * and the layout is stable in any environment.
 *
 * Defaults are font-size 11 and bold on both halves. Measured at 1x against the real
 * shields for-the-badge output:
 *   shields (Verdana) : value 6.50px/char, 8px cap
 *   bold 11px JBM     : value 6.43px/char, 8px cap   <- closest match
 *   bold 10px JBM     : value 5.86px/char (-9.9%), thinner than shields
 *   regular 10px JBM  : 1px strokes, almost no pure-white pixels -> looks blurry
 * Every badge in the target README carries a logo, and shields bolds the label in
 * that case, so label-weight defaults to bold as well.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const ADVANCE_RATIO = 0.6;    // JetBrains Mono: advanceWidth / unitsPerEm = 600 / 1000
const BASELINE_RATIO = 1.75;  // baseline / font-size, from the shields for-the-badge template

const HEIGHT = 28;
const PAD = 12;               // text padding on each side, same as shields for-the-badge
const COLOR_LABEL = '#555';
const COLOR_VALUE = '#007ec6';

const CASE_MODES = {
  preserve: (s) => s,
  upper: (s) => s.toUpperCase(),
  lower: (s) => s.toLowerCase(),
  title: (s) => s.replace(/\w\S*/g, (t) => t[0].toUpperCase() + t.slice(1).toLowerCase()),
};

// Font weights. All JetBrains Mono weights share the same advance width (600/1000),
// so changing the weight never changes the computed layout - only the stroke thickness.
const WEIGHTS = { light: 300, regular: 400, normal: 400, medium: 500, semibold: 600, bold: 700 };

// ---- args ----
const opts = {
  fontSize: 11,
  family: 'JetBrains Mono',
  case: 'preserve',
  labelWeight: 'bold',
  valueWeight: 'bold',
  label: null,
  value: null,
};
const positional = [];
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([\w-]+)=(.*)$/);
  if (m) opts[m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = m[2];
  else positional.push(a);
}

const [inPath, outPath] = positional;
if (!inPath || !outPath) {
  console.error(
    'usage: node make-badge.mjs <in.svg> <out.svg> ' +
      '[--font-size=10] [--family="JetBrains Mono"] [--case=preserve|upper|lower|title] ' +
      '[--label-case=...] [--value-case=...] ' +
      '[--label-weight=regular|medium|semibold|bold] [--value-weight=bold]'
  );
  process.exit(2);
}

// ---- extract label / value ----
const src = readFileSync(inPath, 'utf8');
let { label, value } = opts;

if (!label || !value) {
  // The Ziit badge has a <title> like "CodingTime: 75 hrs 47 mins"
  const text =
    src.match(/<title>([^<]*)<\/title>/)?.[1] ?? src.match(/aria-label="([^"]*)"/)?.[1] ?? '';
  const sep = text.indexOf(':');
  if (sep === -1) {
    console.error('::error::Could not parse "label: value" from badge, got: ' + JSON.stringify(text));
    process.exit(1);
  }
  label = label ?? text.slice(0, sep).trim();
  value = value ?? text.slice(sep + 1).trim();
}
if (!value) {
  console.error('::error::Value is empty, cannot build a badge');
  process.exit(1);
}

// ---- casing ----
const labelMode = opts.labelCase ?? opts.case;
const valueMode = opts.valueCase ?? opts.case;
for (const [name, mode] of [['case', labelMode], ['value-case', valueMode]]) {
  if (!CASE_MODES[mode]) {
    console.error(`::error::Unknown --${name}="${mode}", expected one of: ${Object.keys(CASE_MODES).join(' / ')}`);
    process.exit(1);
  }
}
const labelText = CASE_MODES[labelMode](label);
const valueText = CASE_MODES[valueMode](value);

// ---- weights ----
function resolveWeight(name, key) {
  const w = WEIGHTS[String(name).toLowerCase()];
  if (w === undefined) {
    console.error(`::error::Unknown --${key}="${name}", expected one of: ${Object.keys(WEIGHTS).join(' / ')}`);
    process.exit(1);
  }
  return w;
}
const labelWeight = resolveWeight(opts.labelWeight, 'label-weight');
const valueWeight = resolveWeight(opts.valueWeight, 'value-weight');

// ---- layout ----
const S = Number(opts.fontSize);
if (!Number.isFinite(S) || S <= 0) {
  console.error('::error::--font-size must be a positive number');
  process.exit(1);
}

const charW = ADVANCE_RATIO * S;
const round2 = (n) => Math.round(n * 100) / 100;

const labelBox = round2(labelText.length * charW + PAD * 2);
const valueBox = round2(valueText.length * charW + PAD * 2);
const totalW = round2(labelBox + valueBox);
const baseline = round2(BASELINE_RATIO * S);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const title = `${esc(labelText)}: ${esc(valueText)}`;
const weightAttr = (w) => (w === 400 ? '' : ` font-weight="${w}"`);

writeFileSync(
  outPath,
  `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${HEIGHT}" role="img" aria-label="${title}">` +
    `<title>${title}</title>` +
    `<g shape-rendering="crispEdges">` +
    `<rect width="${labelBox}" height="${HEIGHT}" fill="${COLOR_LABEL}"/>` +
    `<rect x="${labelBox}" width="${valueBox}" height="${HEIGHT}" fill="${COLOR_VALUE}"/>` +
    `</g>` +
    `<g fill="#fff" text-anchor="middle" font-family="${esc(opts.family)}" ` +
    `text-rendering="geometricPrecision" font-size="${S}">` +
    `<text x="${round2(labelBox / 2)}" y="${baseline}"${weightAttr(labelWeight)}>${esc(labelText)}</text>` +
    `<text x="${round2(labelBox + valueBox / 2)}" y="${baseline}"${weightAttr(valueWeight)}>${esc(valueText)}</text>` +
    `</g></svg>\n`
);

console.log(
  `make-badge: "${labelText}" / "${valueText}"  font=${opts.family} ${S}px ` +
    `label-w=${labelWeight} value-w=${valueWeight}  ->  ${totalW}x${HEIGHT}`
);
