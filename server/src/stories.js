// Story packs: one data file per vertical (server/data/stories/<id>.json). Strings may hold {{cast.<role>}} and {{vocab.<key>}}
// tokens. Every token must resolve to a non-empty value, or the whole set is refused at startup (a test does the same for every
// vertical). Rendering happens once, here; the page receives plain text only. The vertical is chosen by customer.config.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const STORY_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/stories');
export const STORY_SCHEMA = 'ptl-story/1';
export const DEFAULT_VERTICAL = 'bank';
const TOKEN = /\{\{\s*([a-z]+)\.([a-zA-Z][a-zA-Z0-9]*)\s*\}\}/g;
const REQUIRED_CAST = ['agent', 'customer', 'approver', 'provider'];
const REQUIRED_VOCAB = ['firm', 'payment', 'payments', 'pay', 'phone', 'approver'];
const REQUIRED_UI = ['ladderLabel', 'paymentHeading', 'phoneHeading', 'phoneNote'];
const REQUIRED_OUTCOME = ['approved', 'denied', 'approval_expired'];
const RUNG_COUNT = 4;

const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;

// Walks every string in the pack, resolving tokens. Returns { story, errors }.
export function renderStory(raw, file = 'story') {
  const errors = [];
  const cast = raw.cast && typeof raw.cast === 'object' ? raw.cast : {};
  const vocab = raw.vocab && typeof raw.vocab === 'object' ? raw.vocab : {};
  for (const [group, values] of [['cast', cast], ['vocab', vocab]]) {
    for (const [k, v] of Object.entries(values)) {
      if (typeof v === 'string' && /\{\{|\}\}/.test(v)) errors.push(`${file}: ${group}.${k} must not hold a token`);
    }
  }
  const render = (value, at) => {
    if (typeof value === 'string') {
      const out = value.replace(TOKEN, (whole, kind, key) => {
        const source = kind === 'cast' ? cast : kind === 'vocab' ? vocab : null;
        if (!source) { errors.push(`${file}: ${at} uses an unknown token kind "${kind}"`); return whole; }
        if (!nonEmpty(source[key])) { errors.push(`${file}: ${at} uses an undefined token {{${kind}.${key}}}`); return whole; }
        return source[key];
      });
      if (/\{\{|\}\}/.test(out)) errors.push(`${file}: ${at} has a malformed token`);
      return out;
    }
    if (Array.isArray(value)) return value.map((v, i) => render(v, `${at}[${i}]`));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, render(v, at ? `${at}.${k}` : k)]));
    }
    return value;
  };
  const story = render(raw, '');
  return { story, errors };
}

// The structural checks every pack must pass (after its tokens render).
export function checkStoryShape(s, file) {
  const errors = [];
  if (s.schema !== STORY_SCHEMA) errors.push(`${file}: schema must be ${STORY_SCHEMA}`);
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(String(s.id))) errors.push(`${file}: id must be a lowercase id`);
  if (path.basename(file, '.json') !== s.id) errors.push(`${file}: file name must match id ${s.id}`);
  if (!nonEmpty(s.title) || !nonEmpty(s.subtitle)) errors.push(`${file}: title and subtitle are required`);
  for (const k of REQUIRED_CAST) if (!nonEmpty(s.cast?.[k])) errors.push(`${file}: cast.${k} is required`);
  for (const k of REQUIRED_VOCAB) if (!nonEmpty(s.vocab?.[k])) errors.push(`${file}: vocab.${k} is required`);
  for (const k of REQUIRED_UI) if (!nonEmpty(s.ui?.[k])) errors.push(`${file}: ui.${k} is required`);
  for (const k of REQUIRED_OUTCOME) if (!nonEmpty(s.ui?.outcome?.[k])) errors.push(`${file}: ui.outcome.${k} is required`);
  if (!Array.isArray(s.rungs) || s.rungs.length !== RUNG_COUNT) errors.push(`${file}: rungs must list exactly ${RUNG_COUNT} rungs`);
  else {
    const names = s.rungs.map((r) => r?.name);
    if (!s.rungs.every((r) => nonEmpty(r?.name) && nonEmpty(r?.needs))) errors.push(`${file}: every rung needs a name and needs text`);
    if (new Set(names).size !== names.length) errors.push(`${file}: rung names must be unique`);
  }
  return errors;
}

// Every pack in the directory, rendered and checked. Throws with all the problems when any pack is refused.
export function loadStories(dir = STORY_DIR) {
  const problems = [];
  const out = new Map();
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const file = path.join(dir, f);
    let raw;
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { problems.push(`${f}: not valid JSON`); continue; }
    const { story, errors } = renderStory(raw, f);
    const shape = errors.length ? [] : checkStoryShape(story, f);
    problems.push(...errors, ...shape);
    if (!errors.length && !shape.length) out.set(story.id, Object.freeze(story));
  }
  if (out.size === 0) problems.push('no story packs found');
  if (problems.length) throw new Error(`story packs refused: ${problems.join('; ')}`);
  return out;
}
