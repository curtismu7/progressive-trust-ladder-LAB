// Optional customer.config.json (git-ignored; the example is committed as customer.config.example.json). It re-skins the demo for
// one customer: a display name, a vertical pack and one brand colour. It is read once at startup and may be shared with a customer,
// so it never holds credentials: a key whose name looks like one is refused. Without the file the defaults are fictional.
// The brand colour reaches the page as CSS tokens (--brand, --brand-on), never as inline markup.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../customer.config.json');
export const MAX_BYTES = 64 * 1024;
export const MAX_DEPTH = 6;
const TOP = ['name', 'vertical', 'brand'];
const SECRETISH = /secret|password|token|key|credential/i;
const HEX = /^#[0-9a-f]{6}$/i;
const VERTICAL = /^[a-z][a-z0-9-]{0,39}$/;
// The brand colour must read on both page backgrounds (light and dark), so one token serves both themes.
const PAGE_BACKGROUNDS = ['#fcfcfc', '#051727']; // the shared stylesheet's --bg in light and dark (web/src/styles/standalone-ui.css)
const MIN_CONTRAST = 3;

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
const plainText = (v, max) => typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= max && !/[\u0000-\u001f\u007f<>]/.test(v);
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lin = (c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
const luminance = (hex) => { const [r, g, b] = rgb(hex).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
// Hue in degrees and saturation (0..1) of a #rrggbb colour.
export function hueOf(hex) {
  const [r, g, b] = rgb(hex).map((c) => c / 255);
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min;
  if (d === 0) return { h: 0, s: 0 };
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: d / (1 - Math.abs(max + min - 1)) };
}
// House rule: no purple. Saturated colours with a hue from 230 (indigo) to 335 (magenta) are refused.
export const isPurple = (hex) => { const { h, s } = hueOf(hex); return s > 0.12 && h >= 230 && h <= 335; };
const onColour = (bg) => (contrast(bg, '#ffffff') >= contrast(bg, '#051727') ? '#ffffff' : '#051727');

// Deepest nesting of objects and arrays, without recursion, so a hostile file cannot overflow the stack.
export function depthOf(v, limit = MAX_DEPTH + 1) {
  let deepest = 0;
  const stack = [[v, 1]];
  while (stack.length) {
    const [x, d] = stack.pop();
    if (!x || typeof x !== 'object') continue;
    if (d > deepest) deepest = d;
    if (deepest > limit) return deepest;
    for (const c of Array.isArray(x) ? x : Object.values(x)) if (c && typeof c === 'object') stack.push([c, d + 1]);
  }
  return deepest;
}
// The same bracket depth read from the raw text before JSON.parse (outside strings).
export function textDepth(text) {
  let d = 0; let max = 0; let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; } else if (c === '"') inStr = true;
    else if (c === '{' || c === '[') { d++; if (d > max) max = d; } else if (c === '}' || c === ']') d--;
  }
  return max;
}

function credentialKeys(v, at, out) {
  if (!isObject(v)) return;
  for (const [k, child] of Object.entries(v)) {
    const here = at ? `${at}.${k}` : k;
    if (SECRETISH.test(k)) out.push(`${here}: the key looks like a credential; this file must never hold secrets`);
    credentialKeys(child, here, out);
  }
}

// Pure check of a parsed file. Returns { config, errors }: config is the sanitized settings, and only when errors is empty.
export function validateCustomerConfig(raw, { verticals = null } = {}) {
  if (!isObject(raw)) return { config: {}, errors: ['file: must be a JSON object'] };
  if (depthOf(raw) > MAX_DEPTH) return { config: {}, errors: [`file: nested deeper than ${MAX_DEPTH} levels`] };
  const errors = [];
  credentialKeys(raw, '', errors);
  if (errors.length) return { config: {}, errors };
  for (const k of Object.keys(raw)) if (!TOP.includes(k)) errors.push(`${k}: unknown field`);
  const config = {};
  if (raw.name !== undefined) {
    if (plainText(raw.name, 40)) config.name = raw.name.trim();
    else errors.push('name: must be 1 to 40 plain characters (no markup)');
  }
  if (raw.vertical !== undefined) {
    if (typeof raw.vertical === 'string' && VERTICAL.test(raw.vertical) && (!verticals || verticals.includes(raw.vertical))) config.vertical = raw.vertical;
    else errors.push(`vertical: must be one of ${verticals ? verticals.join(', ') : 'a lowercase id such as bank'}`);
  }
  if (raw.brand !== undefined) {
    if (!isObject(raw.brand)) errors.push('brand: must be an object');
    else {
      for (const k of Object.keys(raw.brand)) if (k !== 'primary') errors.push(`brand.${k}: unknown field`);
      const p = raw.brand.primary;
      if (typeof p !== 'string' || !HEX.test(p)) errors.push('brand.primary: must be a #rrggbb colour');
      else if (isPurple(p)) errors.push('brand.primary: purple is not allowed in this demo');
      else {
        const hex = p.toLowerCase();
        const weak = PAGE_BACKGROUNDS.find((bg) => contrast(hex, bg) < MIN_CONTRAST);
        if (weak) errors.push(`brand.primary: needs contrast of at least ${MIN_CONTRAST}:1 on both page backgrounds (fails on ${weak})`);
        else config.brand = { primary: hex, on: onColour(hex) };
      }
    }
  }
  return errors.length ? { config: {}, errors } : { config, errors };
}

// Reads and checks the file. An absent file is not an error: the defaults are used. -> { present, file, config, errors }
export function loadCustomerConfig({ file, verticals = null }) {
  let st;
  try { st = fs.statSync(file); } catch { return { present: false, file, config: {}, errors: [] }; }
  if (st.size > MAX_BYTES) return { present: true, file, config: {}, errors: [`file: larger than ${MAX_BYTES} bytes`] };
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { present: true, file, config: {}, errors: ['file: could not be read'] }; }
  if (textDepth(text) > MAX_DEPTH) return { present: true, file, config: {}, errors: [`file: nested deeper than ${MAX_DEPTH} levels`] };
  let parsed;
  try { parsed = JSON.parse(text); } catch { return { present: true, file, config: {}, errors: ['file: not valid JSON'] }; }
  return { present: true, file, ...validateCustomerConfig(parsed, { verticals }) };
}
