// The talk track is DATA (server/data/talk-track.json). docs/talk-track.md is generated from it (npm run talk-track), and a test fails
// when the committed file differs from what the data renders, so the document, the page and the data cannot drift.
// The page shows the text as text (React escapes it), never as HTML.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TALK_TRACK_DATA = path.resolve(HERE, '../data/talk-track.json');
export const TALK_TRACK_FILE = path.resolve(HERE, '../../docs/talk-track.md');
export const MAX_TALK_TRACK_BYTES = 64 * 1024;
export const TALK_TRACK_SCHEMA = 'ptl-talk-track/1';

const text = (v) => typeof v === 'string' && v.trim().length > 0;

// The problems in a parsed talk-track data file; an empty list means it is usable.
export function checkTalkTrackData(d) {
  const p = [];
  if (!d || typeof d !== 'object' || Array.isArray(d)) return ['talk track data must be an object'];
  if (d.schema !== TALK_TRACK_SCHEMA) p.push(`schema must be ${TALK_TRACK_SCHEMA}`);
  if (!text(d.title)) p.push('title is required');
  if (!Array.isArray(d.intro) || !d.intro.length || !d.intro.every(text)) p.push('intro must list paragraphs');
  if (!Array.isArray(d.before) || !d.before.length || !d.before.every(text)) p.push('before must list bullets');
  if (!Array.isArray(d.steps) || !d.steps.length) p.push('steps are required');
  else {
    d.steps.forEach((s, i) => {
      if (!text(s?.title) || !text(s?.time)) p.push(`step ${i + 1}: title and time are required`);
      if (!Array.isArray(s?.lines) || !s.lines.length || !s.lines.every((l) => Array.isArray(l) && l.length === 2 && l.every(text))) p.push(`step ${i + 1}: lines must be [label, text] pairs`);
    });
  }
  if (!Array.isArray(d.faq) || !d.faq.length || !d.faq.every((f) => Array.isArray(f) && f.length === 2 && f.every(text))) p.push('faq must be [question, answer] pairs');
  return p;
}

// The markdown a data file renders to. Deterministic: the same data always gives the same text.
export function renderTalkTrack(d) {
  const out = [`# ${d.title}`, '', ...d.intro.flatMap((para) => [para, '']), '## Before you start', '', ...d.before.map((b) => `- ${b}`), '', '## The path', ''];
  d.steps.forEach((s, i) => {
    out.push(`### ${i + 1}. ${s.title} (${s.time})`, '', ...s.lines.map(([label, body]) => `- **${label}:** ${body}`), '');
  });
  out.push('## What to say if asked', '', ...d.faq.map(([q, a]) => `- **${q}** ${a}`), '');
  return out.join('\n');
}

export function loadTalkTrackData(file = TALK_TRACK_DATA) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const problems = checkTalkTrackData(data);
  if (problems.length) throw new Error(`talk track data refused: ${problems.join('; ')}`);
  return data;
}

// The served talk track: the rendered text, size-capped.
export function loadTalkTrack(file = TALK_TRACK_DATA) {
  const rendered = renderTalkTrack(loadTalkTrackData(file));
  if (Buffer.byteLength(rendered) > MAX_TALK_TRACK_BYTES) throw new Error(`talk track is larger than ${MAX_TALK_TRACK_BYTES} bytes`);
  return { title: 'Talk track', text: rendered };
}
