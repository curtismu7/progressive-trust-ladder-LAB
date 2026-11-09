// The no-purple gate: scans the web source's colours (hex and named) and fails on a purple or violet hue with real saturation.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const PURPLE_NAMES = ['purple', 'violet', 'indigo', 'magenta', 'fuchsia', 'orchid', 'plum', 'mediumpurple', 'blueviolet', 'darkviolet',
  'darkorchid', 'mediumorchid', 'rebeccapurple', 'lavender', 'thistle', 'darkmagenta', 'slateblue', 'mediumslateblue', 'darkslateblue'];
const MIN_SATURATION = 0.15;

// HSL from an RGB triple (0-255): hue in degrees, saturation and lightness in 0..1.
export function hsl(r, g, b) {
  const [R, G, B] = [r, g, b].map((v) => v / 255);
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === R) h = ((G - B) / d) % 6;
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

// A colour string -> a violation message, or null. Purple and violet hues are 230 to 335 degrees.
export function purpleViolation(text) {
  const named = PURPLE_NAMES.find((n) => new RegExp(`(^|[^a-z-])${n}($|[^a-z-])`, 'i').test(text));
  if (named) return `named colour "${named}"`;
  // Every hex value in the text is checked, not only the first.
  for (const m of text.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g)) {
    let hex = m[1];
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    const { h, s } = hsl(parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16));
    if (h >= 230 && h <= 335 && s > MIN_SATURATION) return `hex #${hex} (hue ${Math.round(h)}, saturation ${s.toFixed(2)})`;
  }
  return null;
}

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.(css|jsx?)$/.test(e.name) ? [p] : [];
  });
}

describe('no-purple gate', () => {
  it('flags a purple focus colour and a named purple (the checker itself)', () => {
    expect(purpleViolation('outline: 3px solid #7c3aed;')).toMatch(/hex #7c3aed/);
    expect(purpleViolation('color: rebeccapurple;')).toMatch(/named colour/);
    expect(purpleViolation('color: #0b5cd5;')).toBeNull();
    expect(purpleViolation('color: #1e4fa3;')).toBeNull();
    expect(purpleViolation('a: #0b5cd5;\nb: #7c3aed;')).toMatch(/hex #7c3aed/);
  });

  it('the web source has no purple or violet colour and at least one colour to check', () => {
    const found = [];
    const violations = [];
    for (const file of sourceFiles(SRC)) {
      // Comments may name the rule ("no purple"); only code and values are scanned.
      let text = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      // The vendored family stylesheet (byte-identical to the canonical copy, scripts/check-ui-standard.sh) defines owner-approved
      // evidence-lane tokens used on borders and strokes only; the back-end lane pink (#ff88bb, hue 334) sits on this gate's edge.
      if (path.basename(file) === 'standalone-ui.css') text = text.replace(/--lane-[a-z-]+:\s*#[0-9a-fA-F]{3,6};/g, '');
      for (const m of text.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g)) found.push(m[0]);
      const v = purpleViolation(text);
      if (v) violations.push(`${path.basename(file)}: ${v}`);
    }
    expect(found.length).toBeGreaterThan(10);
    expect(violations).toEqual([]);
  });
});
