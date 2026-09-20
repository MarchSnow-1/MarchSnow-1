#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';

const ADVANCE_RATIO = 0.6;
const CAP_RATIO = 0.73;

const HEIGHT = 28;
const PAD = 12;
const COLOR_LABEL = '#555';
const COLOR_VALUE = '#007ec6';

const CASE_MODES = {
  preserve: (s) => s,
  upper: (s) => s.toUpperCase(),
  lower: (s) => s.toLowerCase(),
  title: (s) => s.replace(/\w\S*/g, (t) => t[0].toUpperCase() + t.slice(1).toLowerCase()),
};

const WEIGHTS = { light: 300, regular: 400, normal: 400, medium: 500, semibold: 600, bold: 700 };

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
      '[--font-size=11] [--family="JetBrains Mono"] [--case=preserve|upper|lower|title] ' +
      '[--label-case=...] [--value-case=...] ' +
      '[--label-weight=regular|medium|semibold|bold] [--value-weight=bold]'
  );
  process.exit(2);
}

const src = readFileSync(inPath, 'utf8');
let { label, value } = opts;

if (!label || !value) {
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
const baseline = round2((HEIGHT + CAP_RATIO * S) / 2);

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
